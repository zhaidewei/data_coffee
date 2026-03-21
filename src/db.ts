import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    const isVercel = !!process.env.VERCEL;
    const url = process.env.TURSO_DATABASE_URL || (isVercel ? "" : "file:local.db");
    if (!url) throw new Error("TURSO_DATABASE_URL is required in production");
    const authToken = process.env.TURSO_AUTH_TOKEN;
    client = createClient({ url, authToken });
  }
  return client;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  invite_code TEXT NOT NULL,
  status      TEXT DEFAULT 'pending',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  city        TEXT,
  company     TEXT,
  role        TEXT,
  skills      TEXT DEFAULT '[]',
  bio         TEXT,
  available   TEXT DEFAULT '[]',
  languages   TEXT DEFAULT '[]',
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coffees (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT REFERENCES users(id),
  topic       TEXT NOT NULL,
  description TEXT,
  city        TEXT,
  location    TEXT,
  scheduled_at DATETIME,
  max_size    INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'open',
  tags        TEXT DEFAULT '[]',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coffee_participants (
  coffee_id   TEXT REFERENCES coffees(id),
  user_id     TEXT REFERENCES users(id),
  role        TEXT DEFAULT 'participant',
  joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (coffee_id, user_id)
);

CREATE TABLE IF NOT EXISTS needs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,
  description TEXT,
  tags        TEXT DEFAULT '[]',
  status      TEXT DEFAULT 'open',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,
  description TEXT,
  tags        TEXT DEFAULT '[]',
  status      TEXT DEFAULT 'open',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT,
  skills_needed TEXT DEFAULT '[]',
  status      TEXT DEFAULT 'recruiting',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id  TEXT REFERENCES projects(id),
  user_id     TEXT REFERENCES users(id),
  role        TEXT,
  joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,
  company     TEXT,
  position    TEXT,
  description TEXT,
  status      TEXT DEFAULT 'open',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  target_type TEXT,
  target_id   TEXT,
  from_user   TEXT REFERENCES users(id),
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  tags        TEXT DEFAULT '[]',
  comment     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id          TEXT PRIMARY KEY,
  week_start  DATE NOT NULL,
  content     TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT,
  used_by     TEXT REFERENCES users(id),
  used_at     DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export async function migrate(): Promise<void> {
  const db = getDb();
  const statements = SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
}
