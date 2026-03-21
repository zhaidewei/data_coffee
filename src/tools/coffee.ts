import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { generateId } from "../auth.js";

export function registerCoffeeTools(server: McpServer) {
  server.tool(
    "coffee_create",
    "Create a new coffee session. Multi-person by default — set max_size to limit participants.",
    {
      topic: z.string().describe("What do you want to chat about?"),
      description: z.string().optional().describe("More details about this coffee"),
      city: z.string().optional().describe("City for offline meetup (omit for online)"),
      location: z.string().optional().describe("Specific venue or online meeting link"),
      scheduled_at: z.string().optional().describe("Planned date/time (ISO 8601)"),
      max_size: z.number().min(0).default(0).describe("Max participants (0 = unlimited)"),
      tags: z.array(z.string()).optional().describe("Topic tags for discovery"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();
      const id = generateId("cof");

      await db.execute({
        sql: `INSERT INTO coffees (id, creator_id, topic, description, city, location, scheduled_at, max_size, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          userId,
          params.topic,
          params.description || null,
          params.city || null,
          params.location || null,
          params.scheduled_at || null,
          params.max_size,
          JSON.stringify(params.tags || []),
        ],
      });

      // Creator auto-joins
      await db.execute({
        sql: "INSERT INTO coffee_participants (coffee_id, user_id, role) VALUES (?, ?, 'creator')",
        args: [id, userId],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              coffee_id: id,
              topic: params.topic,
              status: "open",
              message: "Coffee created! Others can join with coffee_join.",
            }),
          },
        ],
      };
    }
  );

  server.tool(
    "coffee_list",
    "Browse open coffee sessions. Filter by city, tags, or just see what's available.",
    {
      city: z.string().optional().describe("Filter by city"),
      tag: z.string().optional().describe("Filter by tag"),
      limit: z.number().min(1).max(50).default(20).describe("Max results"),
    },
    async (params) => {
      const db = getDb();
      const conditions = ["c.status IN ('open', 'full', 'confirmed')"];
      const args: unknown[] = [];

      // Filter out past coffees (scheduled_at is in the past)
      conditions.push("(c.scheduled_at IS NULL OR c.scheduled_at > datetime('now'))");

      if (params.city) {
        conditions.push("LOWER(c.city) = LOWER(?)");
        args.push(params.city);
      }
      if (params.tag) {
        conditions.push("c.tags LIKE ?");
        args.push(`%${params.tag}%`);
      }

      args.push(params.limit);

      const result = await db.execute({
        sql: `SELECT c.*, u.nickname AS creator_name,
                (SELECT COUNT(*) FROM coffee_participants cp WHERE cp.coffee_id = c.id) AS participant_count
              FROM coffees c
              JOIN users u ON c.creator_id = u.id
              WHERE ${conditions.join(" AND ")}
              ORDER BY CASE WHEN c.scheduled_at IS NOT NULL THEN 0 ELSE 1 END, c.scheduled_at ASC, c.created_at DESC
              LIMIT ?`,
        args: args as any[],
      });

      const coffees = result.rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        description: row.description,
        creator: row.creator_name,
        city: row.city || "online",
        location: row.location,
        scheduled_at: row.scheduled_at,
        participants: row.participant_count,
        max_size: row.max_size,
        status: row.status,
        tags: JSON.parse((row.tags as string) || "[]"),
        created_at: row.created_at,
      }));

      return { content: [{ type: "text", text: JSON.stringify({ coffees, total: coffees.length }) }] };
    }
  );

  server.tool(
    "coffee_join",
    "Join an open coffee session",
    {
      coffee_id: z.string().describe("ID of the coffee to join"),
    },
    async ({ coffee_id }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();

      // Check coffee exists and is open
      const coffee = await db.execute({
        sql: "SELECT * FROM coffees WHERE id = ?",
        args: [coffee_id],
      });
      if (coffee.rows.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Coffee not found" }) }] };
      }

      const c = coffee.rows[0];
      if (c.status !== "open") {
        return { content: [{ type: "text", text: JSON.stringify({ error: `Coffee is ${c.status}, cannot join` }) }] };
      }

      // Check not already joined
      const existing = await db.execute({
        sql: "SELECT 1 FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
        args: [coffee_id, userId],
      });
      if (existing.rows.length > 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "You already joined this coffee" }) }] };
      }

      // Check capacity
      if ((c.max_size as number) > 0) {
        const count = await db.execute({
          sql: "SELECT COUNT(*) as cnt FROM coffee_participants WHERE coffee_id = ?",
          args: [coffee_id],
        });
        const current = count.rows[0].cnt as number;
        if (current >= (c.max_size as number)) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Coffee is full" }) }] };
        }

        // Auto-set to full if this is the last spot
        if (current + 1 >= (c.max_size as number)) {
          await db.execute({
            sql: "UPDATE coffees SET status = 'full' WHERE id = ?",
            args: [coffee_id],
          });
        }
      }

      await db.execute({
        sql: "INSERT INTO coffee_participants (coffee_id, user_id, role) VALUES (?, ?, 'participant')",
        args: [coffee_id, userId],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              coffee_id,
              topic: c.topic,
              message: "You joined the coffee!",
            }),
          },
        ],
      };
    }
  );

  server.tool(
    "coffee_detail",
    "View details of a coffee session including all participants",
    {
      coffee_id: z.string().describe("ID of the coffee"),
    },
    async ({ coffee_id }) => {
      const db = getDb();

      const coffee = await db.execute({
        sql: `SELECT c.*, u.nickname AS creator_name
              FROM coffees c JOIN users u ON c.creator_id = u.id
              WHERE c.id = ?`,
        args: [coffee_id],
      });
      if (coffee.rows.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Coffee not found" }) }] };
      }

      const participants = await db.execute({
        sql: `SELECT u.nickname, p.city, p.role AS job_role, p.skills, cp.role, cp.joined_at
              FROM coffee_participants cp
              JOIN users u ON cp.user_id = u.id
              LEFT JOIN profiles p ON u.id = p.user_id
              WHERE cp.coffee_id = ?`,
        args: [coffee_id],
      });

      const c = coffee.rows[0];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: c.id,
              topic: c.topic,
              description: c.description,
              creator: c.creator_name,
              city: c.city || "online",
              location: c.location,
              scheduled_at: c.scheduled_at,
              max_size: c.max_size,
              status: c.status,
              tags: JSON.parse((c.tags as string) || "[]"),
              participants: participants.rows.map((p) => ({
                nickname: p.nickname,
                city: p.city,
                role: p.job_role,
                skills: JSON.parse((p.skills as string) || "[]"),
                participant_role: p.role,
              })),
            }),
          },
        ],
      };
    }
  );

  server.tool(
    "coffee_leave",
    "Leave a coffee session you joined (creator cannot leave)",
    {
      coffee_id: z.string().describe("ID of the coffee to leave"),
    },
    async ({ coffee_id }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();

      const participation = await db.execute({
        sql: "SELECT role FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
        args: [coffee_id, userId],
      });
      if (participation.rows.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "You are not in this coffee" }) }] };
      }
      if (participation.rows[0].role === "creator") {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Creator cannot leave. Use coffee_cancel instead." }) }] };
      }

      await db.execute({
        sql: "DELETE FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
        args: [coffee_id, userId],
      });

      // Reopen if was full
      await db.execute({
        sql: "UPDATE coffees SET status = 'open' WHERE id = ? AND status = 'full'",
        args: [coffee_id],
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "You left the coffee" }) }] };
    }
  );

  server.tool(
    "coffee_update",
    "Update a coffee session you created. Only the creator can update.",
    {
      coffee_id: z.string().describe("ID of the coffee to update"),
      topic: z.string().optional().describe("New topic"),
      description: z.string().optional().describe("New description"),
      city: z.string().optional().describe("New city"),
      location: z.string().optional().describe("New location"),
      scheduled_at: z.string().optional().describe("New date/time (ISO 8601)"),
      max_size: z.number().min(0).optional().describe("New max participants (0 = unlimited)"),
      tags: z.array(z.string()).optional().describe("New tags"),
    },
    async ({ coffee_id, ...updates }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();

      // Verify ownership
      const coffee = await db.execute({
        sql: "SELECT * FROM coffees WHERE id = ? AND creator_id = ?",
        args: [coffee_id, userId],
      });
      if (coffee.rows.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Coffee not found or you are not the creator" }) }] };
      }

      const fields: string[] = [];
      const args: unknown[] = [];

      if (updates.topic !== undefined) { fields.push("topic = ?"); args.push(updates.topic); }
      if (updates.description !== undefined) { fields.push("description = ?"); args.push(updates.description); }
      if (updates.city !== undefined) { fields.push("city = ?"); args.push(updates.city); }
      if (updates.location !== undefined) { fields.push("location = ?"); args.push(updates.location); }
      if (updates.scheduled_at !== undefined) { fields.push("scheduled_at = ?"); args.push(updates.scheduled_at); }
      if (updates.max_size !== undefined) { fields.push("max_size = ?"); args.push(updates.max_size); }
      if (updates.tags !== undefined) { fields.push("tags = ?"); args.push(JSON.stringify(updates.tags)); }

      if (fields.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
      }

      args.push(coffee_id);
      await db.execute({
        sql: `UPDATE coffees SET ${fields.join(", ")} WHERE id = ?`,
        args: args as any[],
      });

      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Coffee updated", updated_fields: fields.map(f => f.split(" =")[0]) }) }] };
    }
  );

  server.tool(
    "coffee_complete",
    "Mark a coffee session as completed (creator only)",
    {
      coffee_id: z.string().describe("ID of the coffee to complete"),
    },
    async ({ coffee_id }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();
      const result = await db.execute({
        sql: "UPDATE coffees SET status = 'completed' WHERE id = ? AND creator_id = ?",
        args: [coffee_id, userId],
      });

      if (result.rowsAffected === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Coffee not found or you are not the creator" }) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ success: true, message: "Coffee marked as completed" }) }] };
    }
  );
}
