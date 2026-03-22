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

export async function messageSend(
  params: {
    to?: string;
    coffee_id?: string;
    content: string;
    reply_to?: string;
  },
  userId: string
) {
  if (!params.to && !params.coffee_id) {
    return { error: "Either 'to' (nickname) or 'coffee_id' is required" };
  }

  const db = getDb();
  const id = generateId("msg");

  // Coffee group message
  if (params.coffee_id) {
    const membership = await db.execute({
      sql: "SELECT 1 FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
      args: [params.coffee_id, userId],
    });
    if (membership.rows.length === 0) {
      return { error: "You are not a participant of this coffee" };
    }

    const coffee = await db.execute({
      sql: "SELECT topic FROM coffees WHERE id = ?",
      args: [params.coffee_id],
    });
    if (coffee.rows.length === 0) {
      return { error: "Coffee not found" };
    }

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
      message_id: id,
      type: "coffee",
      coffee_id: params.coffee_id,
      coffee_topic: coffee.rows[0].topic,
      participants: participants.rows[0].cnt,
      message: `Message sent to coffee group (${participants.rows[0].cnt} participants)`,
    };
  }

  // Direct message
  const recipient = await db.execute({
    sql: "SELECT id FROM users WHERE LOWER(nickname) = LOWER(?) AND status = 'active'",
    args: [params.to!],
  });
  if (recipient.rows.length === 0) {
    return { error: `User "${params.to}" not found` };
  }

  const toUserId = recipient.rows[0].id as string;
  if (toUserId === userId) {
    return { error: "Cannot send message to yourself" };
  }

  await db.execute({
    sql: `INSERT INTO messages (id, type, from_user, to_user, content, reply_to)
          VALUES (?, 'direct', ?, ?, ?, ?)`,
    args: [id, userId, toUserId, params.content, params.reply_to || null],
  });

  const senderName = await db.execute({
    sql: "SELECT nickname FROM users WHERE id = ?",
    args: [userId],
  });
  const nickname = senderName.rows[0]?.nickname || "Someone";
  await createSystemMessage(toUserId, `${nickname} 给你发了一条私信`);

  return {
    message_id: id,
    type: "direct",
    to: params.to,
    message: `Message sent to ${params.to}`,
  };
}

export async function messageInbox(
  params: {
    type?: "direct" | "coffee" | "system" | "all";
    unread?: boolean;
    coffee_id?: string;
    limit?: number;
  },
  userId: string
) {
  const db = getDb();
  const type = params.type ?? "all";
  const limit = params.limit ?? 20;

  const conditions: string[] = [];
  const args: unknown[] = [];

  if (params.coffee_id) {
    conditions.push("m.type = 'coffee' AND m.coffee_id = ?");
    args.push(params.coffee_id);
  } else if (type === "direct") {
    conditions.push("m.type = 'direct' AND m.to_user = ?");
    args.push(userId);
  } else if (type === "system") {
    conditions.push("m.type = 'system' AND m.to_user = ?");
    args.push(userId);
  } else if (type === "coffee") {
    conditions.push("m.type = 'coffee' AND m.coffee_id IN (SELECT coffee_id FROM coffee_participants WHERE user_id = ?)");
    args.push(userId);
  } else {
    conditions.push(`(
      (m.type = 'direct' AND m.to_user = ?) OR
      (m.type = 'system' AND m.to_user = ?) OR
      (m.type = 'coffee' AND m.coffee_id IN (SELECT coffee_id FROM coffee_participants WHERE user_id = ?))
    )`);
    args.push(userId, userId, userId);
  }

  conditions.push("NOT (m.type = 'coffee' AND m.from_user = ?)");
  args.push(userId);

  if (params.unread) {
    conditions.push("mr.read_at IS NULL");
  }

  const whereClause = conditions.join(" AND ");

  const unreadResult = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM messages m
          LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = ?
          WHERE ${whereClause} AND mr.read_at IS NULL`,
    args: [userId, ...args] as any[],
  });

  args.push(limit);
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
    messages,
    total: messages.length,
    unread_count: unreadResult.rows[0].cnt,
  };
}

export async function messageRead(
  params: {
    message_id?: string;
    coffee_id?: string;
    all?: boolean;
  },
  userId: string
) {
  if (!params.message_id && !params.coffee_id && !params.all) {
    return { error: "Specify message_id, coffee_id, or all: true" };
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

  return { success: true, marked_count: marked };
}
