import { getDb } from "../db.js";
import { generateToken, generateId, createInviteCodes } from "../auth.js";

export async function profileRegister(params: {
  nickname: string;
  bio: string;
  city?: string;
  company?: string;
  role?: string;
  skills?: string[];
  available?: string[];
  languages?: string[];
}) {
  const db = getDb();
  const id = generateId("u");
  const token = generateToken();

  await db.execute({
    sql: "INSERT INTO users (id, nickname, token, invite_code, status) VALUES (?, ?, ?, ?, 'active')",
    args: [id, params.nickname, token, "open"],
  });

  await db.execute({
    sql: `INSERT INTO profiles (user_id, bio, city, company, role, skills, available, languages)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      params.bio,
      params.city || null,
      params.company || null,
      params.role || null,
      JSON.stringify(params.skills || []),
      JSON.stringify(params.available || []),
      JSON.stringify(params.languages || []),
    ],
  });

  return {
    user_id: id,
    token,
    message: "Registration successful. Save your token for future connections.",
  };
}

export async function profileGet(params: { query: string }) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT u.id, u.nickname, u.status, p.city, p.company, p.role, p.skills, p.bio, p.available, p.languages, p.updated_at
          FROM users u LEFT JOIN profiles p ON u.id = p.user_id
          WHERE u.id = ? OR u.nickname LIKE ?`,
    args: [params.query, `%${params.query}%`],
  });

  if (result.rows.length === 0) {
    return { error: "User not found" };
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

  return profiles.length === 1 ? profiles[0] : profiles;
}

export async function profileUpdate(
  params: {
    city?: string;
    company?: string;
    role?: string;
    skills?: string[];
    bio?: string;
    available?: string[];
    languages?: string[];
  },
  userId: string
) {
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
    return { error: "No fields to update" };
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(userId);

  await db.execute({
    sql: `UPDATE profiles SET ${fields.join(", ")} WHERE user_id = ?`,
    args: values as any[],
  });

  return { success: true, message: "Profile updated" };
}

export async function adminCreateInviteCodes(params: { count: number }, userId: string | null) {
  const codes = await createInviteCodes(params.count, userId);
  return { codes, message: `Generated ${params.count} invite codes` };
}
