import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db.js";
import {
  generateToken,
  generateId,
  createInviteCodes,
} from "../auth.js";

export function registerProfileTools(server: McpServer) {
  server.tool(
    "profile_register",
    "Register a new member. Returns a token for future authentication.",
    {
      nickname: z.string().describe("Your display name"),
      bio: z.string().describe("Self-introduction in natural language (skills, role, city, etc.)"),
    },
    async ({ nickname, bio }) => {
      const db = getDb();
      const id = generateId("u");
      const token = generateToken();

      await db.execute({
        sql: "INSERT INTO users (id, nickname, token, invite_code, status) VALUES (?, ?, ?, ?, 'active')",
        args: [id, nickname, token, "open"],
      });

      await db.execute({
        sql: "INSERT INTO profiles (user_id, bio) VALUES (?, ?)",
        args: [id, bio],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              user_id: id,
              token,
              message: "Registration successful. Save your token for future connections.",
            }),
          },
        ],
      };
    }
  );

  server.tool(
    "profile_get",
    "Get a member's profile by user ID or nickname",
    {
      query: z.string().describe("User ID or nickname to look up"),
    },
    async ({ query }, { authInfo }) => {
      const db = getDb();
      const result = await db.execute({
        sql: `SELECT u.id, u.nickname, u.status, p.city, p.company, p.role, p.skills, p.bio, p.available, p.languages, p.updated_at
              FROM users u LEFT JOIN profiles p ON u.id = p.user_id
              WHERE u.id = ? OR u.nickname LIKE ?`,
        args: [query, `%${query}%`],
      });

      if (result.rows.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "User not found" }) }] };
      }

      const profiles = result.rows.map((row) => ({
        user_id: row.id,
        nickname: row.nickname,
        status: row.status,
        city: row.city,
        company: row.company,
        role: row.role,
        skills: JSON.parse((row.skills as string) || "[]"),
        bio: row.bio,
        available: JSON.parse((row.available as string) || "[]"),
        languages: JSON.parse((row.languages as string) || "[]"),
      }));

      return { content: [{ type: "text", text: JSON.stringify(profiles.length === 1 ? profiles[0] : profiles) }] };
    }
  );

  server.tool(
    "profile_update",
    "Update your own profile",
    {
      city: z.string().optional().describe("City in Netherlands (e.g. Amsterdam, Rotterdam)"),
      company: z.string().optional().describe("Company or organization"),
      role: z.string().optional().describe("Job title / role"),
      skills: z.array(z.string()).optional().describe("List of skills/technologies"),
      bio: z.string().optional().describe("Updated self-introduction"),
      available: z.array(z.string()).optional().describe("Availability slots (e.g. weekday_evening, weekend)"),
      languages: z.array(z.string()).optional().describe("Languages spoken"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();
      const fields: string[] = [];
      const values: unknown[] = [];

      if (params.city !== undefined) { fields.push("city = ?"); values.push(params.city); }
      if (params.company !== undefined) { fields.push("company = ?"); values.push(params.company); }
      if (params.role !== undefined) { fields.push("role = ?"); values.push(params.role); }
      if (params.skills !== undefined) { fields.push("skills = ?"); values.push(JSON.stringify(params.skills)); }
      if (params.bio !== undefined) { fields.push("bio = ?"); values.push(params.bio); }
      if (params.available !== undefined) { fields.push("available = ?"); values.push(JSON.stringify(params.available)); }
      if (params.languages !== undefined) { fields.push("languages = ?"); values.push(JSON.stringify(params.languages)); }

      if (fields.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
      }

      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(userId);

      await db.execute({
        sql: `UPDATE profiles SET ${fields.join(", ")} WHERE user_id = ?`,
        args: values as any[],
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Profile updated" }) }] };
    }
  );

  server.tool(
    "admin_create_invite_codes",
    "Generate invite codes (admin only). First registered user is auto-admin.",
    {
      count: z.number().min(1).max(50).describe("Number of invite codes to generate"),
    },
    async ({ count }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      const codes = await createInviteCodes(count, userId || null);
      return {
        content: [{ type: "text", text: JSON.stringify({ codes, message: `Generated ${count} invite codes` }) }],
      };
    }
  );
}
