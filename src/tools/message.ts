import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { generateId } from "../auth.js";

/** Insert a system notification */
export async function createSystemMessage(toUser: string, content: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO messages (id, type, from_user, to_user, content) VALUES (?, 'system', NULL, ?, ?)`,
    args: [generateId("msg"), toUser, content],
  });
}

export function registerMessageTools(server: McpServer) {
  server.tool(
    "message_send",
    "Send a direct message to a member (by nickname) or a group message to a coffee session.",
    {
      to: z.string().optional().describe("Recipient nickname (for direct message)"),
      coffee_id: z.string().optional().describe("Coffee ID (for group message)"),
      content: z.string().describe("Message content"),
      reply_to: z.string().optional().describe("Message ID to reply to"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      if (!params.to && !params.coffee_id) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Either 'to' (nickname) or 'coffee_id' is required" }) }] };
      }

      const db = getDb();
      const id = generateId("msg");

      // Coffee group message
      if (params.coffee_id) {
        // Verify sender is a participant
        const membership = await db.execute({
          sql: "SELECT 1 FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
          args: [params.coffee_id, userId],
        });
        if (membership.rows.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "You are not a participant of this coffee" }) }] };
        }

        // Get coffee topic for response
        const coffee = await db.execute({
          sql: "SELECT topic FROM coffees WHERE id = ?",
          args: [params.coffee_id],
        });
        if (coffee.rows.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Coffee not found" }) }] };
        }

        // Get participant count
        const participants = await db.execute({
          sql: "SELECT COUNT(*) as cnt FROM coffee_participants WHERE coffee_id = ?",
          args: [params.coffee_id],
        });

        await db.execute({
          sql: `INSERT INTO messages (id, type, from_user, coffee_id, content, reply_to)
                VALUES (?, 'coffee', ?, ?, ?, ?)`,
          args: [id, userId, params.coffee_id, params.content, params.reply_to || null],
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message_id: id,
              type: "coffee",
              coffee_id: params.coffee_id,
              coffee_topic: coffee.rows[0].topic,
              participants: participants.rows[0].cnt,
              message: `Message sent to coffee group (${participants.rows[0].cnt} participants)`,
            }),
          }],
        };
      }

      // Direct message
      const recipient = await db.execute({
        sql: "SELECT id FROM users WHERE LOWER(nickname) = LOWER(?) AND status = 'active'",
        args: [params.to!],
      });
      if (recipient.rows.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `User "${params.to}" not found` }) }] };
      }

      const toUserId = recipient.rows[0].id as string;
      if (toUserId === userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Cannot send message to yourself" }) }] };
      }

      await db.execute({
        sql: `INSERT INTO messages (id, type, from_user, to_user, content, reply_to)
              VALUES (?, 'direct', ?, ?, ?, ?)`,
        args: [id, userId, toUserId, params.content, params.reply_to || null],
      });

      // Auto-generate system notification for recipient
      const senderName = await db.execute({
        sql: "SELECT nickname FROM users WHERE id = ?",
        args: [userId],
      });
      const nickname = senderName.rows[0]?.nickname || "Someone";
      await createSystemMessage(toUserId, `${nickname} 给你发了一条私信`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            message_id: id,
            type: "direct",
            to: params.to,
            message: `Message sent to ${params.to}`,
          }),
        }],
      };
    }
  );

  server.tool(
    "message_inbox",
    "View your inbox — direct messages, coffee group messages, and system notifications.",
    {
      type: z.enum(["direct", "coffee", "system", "all"]).default("all").describe("Filter by message type"),
      unread: z.boolean().default(false).describe("Show only unread messages"),
      coffee_id: z.string().optional().describe("View messages for a specific coffee"),
      limit: z.number().min(1).max(50).default(20).describe("Max results"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      const db = getDb();

      // Build WHERE conditions
      const conditions: string[] = [];
      const args: unknown[] = [];

      if (params.coffee_id) {
        // Specific coffee messages
        conditions.push("m.type = 'coffee' AND m.coffee_id = ?");
        args.push(params.coffee_id);
      } else if (params.type === "direct") {
        conditions.push("m.type = 'direct' AND m.to_user = ?");
        args.push(userId);
      } else if (params.type === "system") {
        conditions.push("m.type = 'system' AND m.to_user = ?");
        args.push(userId);
      } else if (params.type === "coffee") {
        // All coffee messages where user is participant
        conditions.push("m.type = 'coffee' AND m.coffee_id IN (SELECT coffee_id FROM coffee_participants WHERE user_id = ?)");
        args.push(userId);
      } else {
        // All: direct to me + system to me + coffee groups I'm in
        conditions.push(`(
          (m.type = 'direct' AND m.to_user = ?) OR
          (m.type = 'system' AND m.to_user = ?) OR
          (m.type = 'coffee' AND m.coffee_id IN (SELECT coffee_id FROM coffee_participants WHERE user_id = ?))
        )`);
        args.push(userId, userId, userId);
      }

      // Exclude own coffee messages from inbox
      conditions.push("NOT (m.type = 'coffee' AND m.from_user = ?)");
      args.push(userId);

      if (params.unread) {
        conditions.push("mr.read_at IS NULL");
      }

      const whereClause = conditions.join(" AND ");

      // Count unread
      const unreadResult = await db.execute({
        sql: `SELECT COUNT(*) as cnt FROM messages m
              LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
              WHERE ${whereClause} AND mr.read_at IS NULL`,
        args: [userId, ...args] as any[],
      });

      // Fetch messages
      args.push(params.limit);
      const result = await db.execute({
        sql: `SELECT m.id, m.type, m.content, m.coffee_id, m.reply_to, m.created_at,
                     u.nickname AS from_nickname,
                     c.topic AS coffee_topic,
                     CASE WHEN mr.read_at IS NOT NULL THEN 1 ELSE 0 END AS is_read
              FROM messages m
              LEFT JOIN users u ON m.from_user = u.id
              LEFT JOIN coffees c ON m.coffee_id = c.id
              LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
              WHERE ${whereClause}
              ORDER BY m.created_at DESC
              LIMIT ?`,
        args: [userId, ...args] as any[],
      });

      const messages = result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        from: row.from_nickname || "system",
        content: row.content,
        coffee_id: row.coffee_id || undefined,
        coffee_topic: row.coffee_topic || undefined,
        reply_to: row.reply_to || undefined,
        read: !!row.is_read,
        created_at: row.created_at,
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            messages,
            total: messages.length,
            unread_count: unreadResult.rows[0].cnt,
          }),
        }],
      };
    }
  );

  server.tool(
    "message_read",
    "Mark messages as read.",
    {
      message_id: z.string().optional().describe("Mark a single message as read"),
      coffee_id: z.string().optional().describe("Mark all messages in a coffee as read"),
      all: z.boolean().optional().describe("Mark all unread messages as read"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }] };
      }

      if (!params.message_id && !params.coffee_id && !params.all) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Specify message_id, coffee_id, or all: true" }) }] };
      }

      const db = getDb();
      let marked = 0;

      if (params.message_id) {
        const result = await db.execute({
          sql: `INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)`,
          args: [params.message_id, userId],
        });
        marked = result.rowsAffected;
      } else if (params.coffee_id) {
        // Mark all unread coffee messages
        const unread = await db.execute({
          sql: `SELECT m.id FROM messages m
                LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
                WHERE m.coffee_id = ? AND mr.read_at IS NULL`,
          args: [userId, params.coffee_id],
        });
        for (const row of unread.rows) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)`,
            args: [row.id, userId],
          });
        }
        marked = unread.rows.length;
      } else if (params.all) {
        // Mark all unread messages (direct + system to me, coffee groups I'm in)
        const unread = await db.execute({
          sql: `SELECT m.id FROM messages m
                LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
                WHERE mr.read_at IS NULL AND (
                  (m.to_user = ?) OR
                  (m.type = 'coffee' AND m.coffee_id IN (SELECT coffee_id FROM coffee_participants WHERE user_id = ?))
                )`,
          args: [userId, userId, userId],
        });
        for (const row of unread.rows) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?, ?)`,
            args: [row.id, userId],
          });
        }
        marked = unread.rows.length;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, marked_count: marked }),
        }],
      };
    }
  );
}
