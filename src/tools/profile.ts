import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  profileRegister,
  profileGet,
  profileUpdate,
  adminCreateInviteCodes,
} from "../services/profile.js";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerProfileTools(server: McpServer) {
  server.tool(
    "profile_register",
    "Register a new member. Returns a token for future authentication.",
    {
      nickname: z.string().describe("Your display name"),
      bio: z.string().describe("Self-introduction in natural language (skills, role, city, etc.)"),
      city: z.string().optional().describe("City in Netherlands (e.g. Amsterdam, Rotterdam)"),
      company: z.string().optional().describe("Company or organization"),
      role: z.string().optional().describe("Job title / role"),
      skills: z.array(z.string()).optional().describe("List of skills/technologies"),
      available: z.array(z.string()).optional().describe("Availability slots (e.g. weekday_evening, weekend)"),
      languages: z.array(z.string()).optional().describe("Languages spoken"),
    },
    async (params) => jsonResult(await profileRegister(params))
  );

  server.tool(
    "profile_get",
    "Get a member's profile by user ID or nickname",
    {
      query: z.string().describe("User ID or nickname to look up"),
    },
    async ({ query }) => jsonResult(await profileGet({ query }))
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
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await profileUpdate(params, userId));
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
      return jsonResult(await adminCreateInviteCodes({ count }, userId || null));
    }
  );
}
