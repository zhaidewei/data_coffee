import type { Env, User } from './types';
import { sendEmail } from './mail';
import { fail } from './engine';

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const COOKIE = 'dc_session';
const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const failure = (message: string, status = 400) => reply({ error: message }, status);
const invalidCode = () => failure('验证码无效或已过期，请重新获取。');
const now = () => Date.now();
const local = (request: Request) => ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function token(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
function otp(): string {
  // Rejection sampling avoids the modulo bias of a six-digit random code.
  let n: number;
  do { n = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (n >= 4294000000);
  return (n % 1000000).toString().padStart(6, '0');
}
function sessionToken(request: Request): string | null {
  const raw = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}
function cookie(request: Request, value: string, seconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' || !local(request);
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
interface UserRow { id: string; email: string; nickname: string; public_nickname: number }
const asUser = (row: UserRow): User => ({ id: row.id, email: row.email, nickname: row.nickname, publicNickname: row.public_nickname === 1 });
export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const authorization = request.headers.get('Authorization');
  if (authorization !== null) {
    const raw = authorization.match(/^Bearer (dcf_[a-f0-9]{64})$/i)?.[1];
    if (!raw) fail('API token 无效或已过期', 401);
    const row = await env.DB.prepare(`SELECT u.*, t.scope FROM users u JOIN personal_tokens t ON t.user_id=u.id
      WHERE t.token_hash=? AND t.expires_at>? AND t.revoked_at IS NULL`).bind(await hash(raw!), now()).first<UserRow & {scope:string}>();
    if (!row) fail('API token 无效或已过期', 401);
    if (row!.scope === 'read' && !['GET','HEAD'].includes(request.method)) fail('此 token 仅允许读取', 403);
    return asUser(row!);
  }
  const raw = sessionToken(request);
  if (!raw) return null;
  const row = await env.DB.prepare(`SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>?`).bind(await hash(raw), now()).first<UserRow>();
  return row ? asUser(row) : null;
}
async function rate(env: Env, key: string, maximum: number, windowMs: number): Promise<boolean> {
  const start = Math.floor(now() / windowMs) * windowMs;
  const row = await env.DB.prepare(`INSERT INTO auth_rate_limits(key,window_start,count) VALUES (?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,
    window_start=excluded.window_start RETURNING count`).bind(key, start).first<{ count: number }>();
  return !!row && row.count <= maximum;
}
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return null;
  if (Number(request.headers.get('Content-Length') || 0) > 4096) return null;
  // Bound streamed bodies too; Content-Length is optional and untrusted.
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > 4096) { await reader.cancel(); return null; }
    chunks.push(result.value);
  }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(joined));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
function emailValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}
function nicknameValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 40 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
}
export async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['/api/auth/request', '/api/auth/verify', '/api/auth/logout', '/api/me'].includes(path)) return null;
  if ((path !== '/api/me' && request.method !== 'POST') || (path === '/api/me' && !['GET', 'PATCH'].includes(request.method))) return failure('不支持此操作。', 405);
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return failure('请求来源无效。', 403);
  }
  if (path === '/api/auth/logout') {
    const raw = sessionToken(request);
    if (raw) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash(raw)).run();
    return reply({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (path === '/api/me' && request.method === 'GET') return reply({ user: await currentUser(request, env) });
  const data = await body(request);
  if (!data) return failure('请输入有效的信息。');
  if (path === '/api/me') {
    const user = await currentUser(request, env);
    if (!user) return failure('请先验证邮箱。', 401);
    const nickname = data.nickname === undefined ? user.nickname : nicknameValue(data.nickname);
    if (!nickname || (data.publicNickname !== undefined && typeof data.publicNickname !== 'boolean')) return failure('昵称需为 1–40 个字符。');
    const publicNickname = typeof data.publicNickname === 'boolean' ? data.publicNickname : user.publicNickname;
    await env.DB.prepare('UPDATE users SET nickname=?,public_nickname=? WHERE id=?').bind(nickname, +publicNickname, user.id).run();
    return reply({ user: { ...user, nickname, publicNickname } });
  }
  const email = emailValue(data.email);
  if (!email) return failure('请输入有效的邮箱地址。');
  const emailHash = await hash(email);
  const ipHash = await hash(request.headers.get('CF-Connecting-IP') || 'unknown');
  if (path === '/api/auth/request') {
    const development = env.APP_ENV === 'development' && local(request) && !env.BREVO_API_KEY;
    if (!development && (!env.BREVO_API_KEY || !env.EMAIL_FROM)) return failure('邮件服务尚未配置，请稍后再试。', 503);
    const checks = await Promise.all([
      rate(env, `request:email:${emailHash}`, 3, 15 * 60_000),
      rate(env, `request:ip:${ipHash}`, 20, 60 * 60_000),
      rate(env, `request:cooldown:${emailHash}`, 1, 60_000),
    ]);
    if (checks.includes(false)) return failure('操作过于频繁，请稍后重试。', 429);
    const code = otp(), nonce = token();
    await env.DB.prepare(`INSERT INTO auth_codes(email_hash,nonce,code_hash,expires_at,attempts,consumed_at) VALUES (?,?,?,?,0,NULL)
      ON CONFLICT(email_hash) DO UPDATE SET nonce=excluded.nonce,code_hash=excluded.code_hash,
      expires_at=excluded.expires_at,attempts=0,consumed_at=NULL`).bind(emailHash, nonce, await hash(`${nonce}:${code}`), now() + 10 * 60_000).run();
    if (!development) {
      try { await sendEmail(env, email, 'Data Coffee 登录验证码', `你的 Data Coffee 登录验证码是：${code}\n\n验证码 10 分钟内有效，仅可使用一次。请勿向他人透露。\n若非本人操作，请忽略此邮件。`); }
      catch {
        await env.DB.prepare('DELETE FROM auth_codes WHERE email_hash=? AND nonce=?').bind(emailHash, nonce).run();
        return failure('邮件暂时无法发送，请稍后重试。', 503);
      }
    }
    return reply({ ok: true, message: '请查看邮箱中的验证码。', ...(development ? { developmentCode: code } : {}) });
  }
  const checks = await Promise.all([
    rate(env, `verify:email:${emailHash}`, 15, 15 * 60_000),
    rate(env, `verify:ip:${ipHash}`, 100, 15 * 60_000),
  ]);
  if (checks.includes(false)) return failure('操作过于频繁，请稍后重试。', 429);
  const nickname = nicknameValue(data.nickname);
  if (!nickname) return failure('请输入 1–40 个字符的昵称。');
  if (typeof data.code !== 'string' || !/^\d{6}$/.test(data.code)) return invalidCode();
  const row = await env.DB.prepare('SELECT nonce FROM auth_codes WHERE email_hash=?').bind(emailHash).first<{ nonce: string }>();
  if (!row) return invalidCode();
  const digest = await hash(`${row.nonce}:${data.code}`);
  // Each contender increments attempts and consumes the code in the SAME statement.
  // RETURNING only produces a successful consume for the unique winning verifier.
  const result = await env.DB.prepare(`UPDATE auth_codes SET attempts=attempts+1,
    consumed_at=CASE WHEN code_hash=? THEN ? ELSE NULL END
    WHERE email_hash=? AND nonce=? AND consumed_at IS NULL AND expires_at>? AND attempts<5
    RETURNING consumed_at`).bind(digest, now(), emailHash, row.nonce, now()).first<{ consumed_at: number | null }>();
  if (!result?.consumed_at) return invalidCode();
  const raw = token(), sessionHash = await hash(raw), id = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare('INSERT INTO users(id,email,nickname) VALUES (?,?,?) ON CONFLICT(email) DO NOTHING').bind(id, email, nickname),
    env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE email=?').bind(sessionHash, now() + SESSION_SECONDS * 1000, email),
    env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email),
  ]);
  const user = asUser(results[2]!.results[0] as unknown as UserRow);
  return reply({ user }, 200, { 'Set-Cookie': cookie(request, raw, SESSION_SECONDS) });
}

// Token management is deliberately bound to an interactive cookie session.
export async function handleTokens(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/tokens' && !path.startsWith('/api/tokens/')) return null;
  if (request.headers.has('Authorization')) return failure('请使用网页登录管理 API token', 403);
  const user = await currentUser(request, env);
  if (!user) return failure('请先验证邮箱登录', 401);
  const columns = 'id,name,scope,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt';
  if (path === '/api/tokens' && request.method === 'GET') {
    const rows = await env.DB.prepare(`SELECT ${columns} FROM personal_tokens WHERE user_id=? ORDER BY created_at DESC`).bind(user.id).all();
    return reply({tokens:rows.results});
  }
  if (path === '/api/tokens' && request.method === 'POST') {
    const data = await body(request);
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const scope = data?.scope;
    const days = data?.expiresDays === undefined ? 30 : data.expiresDays;
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || (scope !== 'read' && scope !== 'write') || !Number.isInteger(days) || Number(days)<1 || Number(days)>365) return failure('请输入名称、read/write 权限和 1–365 天有效期');
    const raw = `dcf_${token()}`, id = crypto.randomUUID(), createdAt = now(), expiresAt = createdAt + Number(days)*86400000;
    await env.DB.prepare('INSERT INTO personal_tokens(id,user_id,name,scope,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind(id,user.id,name,scope,await hash(raw),createdAt,expiresAt).run();
    return reply({token:raw,id,name,scope,createdAt,expiresAt,revokedAt:null},201);
  }
  const match = path.match(/^\/api\/tokens\/([a-zA-Z0-9-]+)$/);
  if (match && request.method === 'DELETE') {
    const row = await env.DB.prepare('UPDATE personal_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=? RETURNING id').bind(now(),match[1],user.id).first();
    return row ? reply({revoked:true,id:match[1]}) : failure('Token 不存在',404);
  }
  return failure('不支持此操作',405);
}
