import { randomBytes } from "crypto";
import { getDb } from "./db.js";

export function generateToken(): string {
  return `dc_${randomBytes(24).toString("hex")}`;
}

export function generateInviteCode(): string {
  return `inv_${randomBytes(8).toString("hex")}`;
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export async function validateToken(
  token: string | undefined
): Promise<{ userId: string; status: string } | null> {
  if (!token) return null;
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT id, status FROM users WHERE token = ?",
    args: [token],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { userId: row.id as string, status: row.status as string };
}

export async function validateInviteCode(code: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL",
    args: [code],
  });
  return result.rows.length > 0;
}

export async function markInviteCodeUsed(
  code: string,
  userId: string
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?",
    args: [userId, code],
  });
}

export async function createInviteCodes(
  count: number,
  createdBy: string | null
): Promise<string[]> {
  const db = getDb();
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = generateInviteCode();
    await db.execute({
      sql: "INSERT INTO invite_codes (code, created_by) VALUES (?, ?)",
      args: [code, createdBy],
    });
    codes.push(code);
  }
  return codes;
}

export function extractBearerToken(authHeader: string | null): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") return parts[1];
  return undefined;
}
