import { getDb } from "../db.js";
import { generateId } from "../auth.js";
import { createSystemMessage } from "./message.js";

export async function coffeeCreate(
  params: {
    topic: string;
    description?: string;
    city?: string;
    location?: string;
    scheduled_at?: string;
    max_size?: number;
    tags?: string[];
  },
  userId: string
) {
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
      params.max_size ?? 0,
      JSON.stringify(params.tags || []),
    ],
  });

  // Creator auto-joins
  await db.execute({
    sql: "INSERT INTO coffee_participants (coffee_id, user_id, role) VALUES (?, ?, 'creator')",
    args: [id, userId],
  });

  return {
    coffee_id: id,
    topic: params.topic,
    status: "open",
    message: "Coffee created! Others can join with coffee_join.",
  };
}

export async function coffeeList(params: { city?: string; tag?: string; limit?: number }) {
  const db = getDb();
  const conditions = ["c.status IN ('open', 'full', 'confirmed')"];
  const args: unknown[] = [];

  conditions.push("(c.scheduled_at IS NULL OR c.scheduled_at > datetime('now'))");

  if (params.city) {
    conditions.push("LOWER(c.city) = LOWER(?)");
    args.push(params.city);
  }
  if (params.tag) {
    conditions.push("c.tags LIKE ?");
    args.push(`%${params.tag}%`);
  }

  const limit = params.limit ?? 20;
  args.push(limit);

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

  return { coffees, total: coffees.length };
}

export async function coffeeJoin(params: { coffee_id: string }, userId: string) {
  const db = getDb();

  const coffee = await db.execute({
    sql: "SELECT * FROM coffees WHERE id = ?",
    args: [params.coffee_id],
  });
  if (coffee.rows.length === 0) {
    return { error: "Coffee not found" };
  }

  const c = coffee.rows[0];
  if (c.status !== "open") {
    return { error: `Coffee is ${c.status}, cannot join` };
  }

  const existing = await db.execute({
    sql: "SELECT 1 FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
    args: [params.coffee_id, userId],
  });
  if (existing.rows.length > 0) {
    return { error: "You already joined this coffee" };
  }

  if ((c.max_size as number) > 0) {
    const count = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM coffee_participants WHERE coffee_id = ?",
      args: [params.coffee_id],
    });
    const current = count.rows[0].cnt as number;
    if (current >= (c.max_size as number)) {
      return { error: "Coffee is full" };
    }

    if (current + 1 >= (c.max_size as number)) {
      await db.execute({
        sql: "UPDATE coffees SET status = 'full' WHERE id = ?",
        args: [params.coffee_id],
      });
    }
  }

  await db.execute({
    sql: "INSERT INTO coffee_participants (coffee_id, user_id, role) VALUES (?, ?, 'participant')",
    args: [params.coffee_id, userId],
  });

  const joiner = await db.execute({ sql: "SELECT nickname FROM users WHERE id = ?", args: [userId] });
  const joinerName = joiner.rows[0]?.nickname || "Someone";
  await createSystemMessage(c.creator_id as string, `${joinerName} 加入了你的 coffee「${c.topic}」`);

  return {
    success: true,
    coffee_id: params.coffee_id,
    topic: c.topic,
    message: "You joined the coffee!",
  };
}

export async function coffeeDetail(params: { coffee_id: string }) {
  const db = getDb();

  const coffee = await db.execute({
    sql: `SELECT c.*, u.nickname AS creator_name
          FROM coffees c JOIN users u ON c.creator_id = u.id
          WHERE c.id = ?`,
    args: [params.coffee_id],
  });
  if (coffee.rows.length === 0) {
    return { error: "Coffee not found" };
  }

  const participants = await db.execute({
    sql: `SELECT u.nickname, p.city, p.role AS job_role, p.skills, cp.role, cp.joined_at
          FROM coffee_participants cp
          JOIN users u ON cp.user_id = u.id
          LEFT JOIN profiles p ON u.id = p.user_id
          WHERE cp.coffee_id = ?`,
    args: [params.coffee_id],
  });

  const c = coffee.rows[0];
  return {
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
  };
}

export async function coffeeLeave(params: { coffee_id: string }, userId: string) {
  const db = getDb();

  const participation = await db.execute({
    sql: "SELECT role FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
    args: [params.coffee_id, userId],
  });
  if (participation.rows.length === 0) {
    return { error: "You are not in this coffee" };
  }
  if (participation.rows[0].role === "creator") {
    return { error: "Creator cannot leave. Use coffee_cancel instead." };
  }

  await db.execute({
    sql: "DELETE FROM coffee_participants WHERE coffee_id = ? AND user_id = ?",
    args: [params.coffee_id, userId],
  });

  await db.execute({
    sql: "UPDATE coffees SET status = 'open' WHERE id = ? AND status = 'full'",
    args: [params.coffee_id],
  });

  const coffee = await db.execute({ sql: "SELECT creator_id, topic FROM coffees WHERE id = ?", args: [params.coffee_id] });
  if (coffee.rows.length > 0) {
    const leaver = await db.execute({ sql: "SELECT nickname FROM users WHERE id = ?", args: [userId] });
    const leaverName = leaver.rows[0]?.nickname || "Someone";
    await createSystemMessage(coffee.rows[0].creator_id as string, `${leaverName} 退出了你的 coffee「${coffee.rows[0].topic}」`);
  }

  return { success: true, message: "You left the coffee" };
}

export async function coffeeUpdate(
  params: {
    coffee_id: string;
    topic?: string;
    description?: string;
    city?: string;
    location?: string;
    scheduled_at?: string;
    max_size?: number;
    tags?: string[];
  },
  userId: string
) {
  const db = getDb();

  const coffee = await db.execute({
    sql: "SELECT * FROM coffees WHERE id = ? AND creator_id = ?",
    args: [params.coffee_id, userId],
  });
  if (coffee.rows.length === 0) {
    return { error: "Coffee not found or you are not the creator" };
  }

  const fields: string[] = [];
  const args: unknown[] = [];

  if (params.topic !== undefined) { fields.push("topic = ?"); args.push(params.topic); }
  if (params.description !== undefined) { fields.push("description = ?"); args.push(params.description); }
  if (params.city !== undefined) { fields.push("city = ?"); args.push(params.city); }
  if (params.location !== undefined) { fields.push("location = ?"); args.push(params.location); }
  if (params.scheduled_at !== undefined) { fields.push("scheduled_at = ?"); args.push(params.scheduled_at); }
  if (params.max_size !== undefined) { fields.push("max_size = ?"); args.push(params.max_size); }
  if (params.tags !== undefined) { fields.push("tags = ?"); args.push(JSON.stringify(params.tags)); }

  if (fields.length === 0) {
    return { error: "No fields to update" };
  }

  args.push(params.coffee_id);
  await db.execute({
    sql: `UPDATE coffees SET ${fields.join(", ")} WHERE id = ?`,
    args: args as any[],
  });

  return { success: true, message: "Coffee updated", updated_fields: fields.map(f => f.split(" =")[0]) };
}

export async function coffeeComplete(params: { coffee_id: string }, userId: string) {
  const db = getDb();

  const coffeeInfo = await db.execute({
    sql: "SELECT topic FROM coffees WHERE id = ? AND creator_id = ?",
    args: [params.coffee_id, userId],
  });
  if (coffeeInfo.rows.length === 0) {
    return { error: "Coffee not found or you are not the creator" };
  }

  await db.execute({
    sql: "UPDATE coffees SET status = 'completed' WHERE id = ?",
    args: [params.coffee_id],
  });

  const participants = await db.execute({
    sql: "SELECT user_id FROM coffee_participants WHERE coffee_id = ? AND user_id != ?",
    args: [params.coffee_id, userId],
  });
  const topic = coffeeInfo.rows[0].topic as string;
  for (const p of participants.rows) {
    await createSystemMessage(p.user_id as string, `Coffee「${topic}」已完成，欢迎提交反馈`);
  }

  return { success: true, message: "Coffee marked as completed" };
}
