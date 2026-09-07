import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { handleAuth, hash } from '../worker/auth';
import { drainMail, sendEmail } from '../worker/mail';
import type { Env } from '../worker/types';
let mf: Miniflare; let env: Env;
beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'auth', modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-09-05', d1Databases: { DB: 'auth-test' } }));
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0001_events.sql', '0002_identity.sql']) {
    const sql = (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await DB.prepare(statement).run();
  }
  env = { DB, ASSETS: {} as Fetcher, APP_ENV: 'development' };
});
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  for (const table of ['auth_sessions', 'auth_codes', 'auth_rate_limits', 'mail_dispatch', 'mail_daily_budget', 'outbox', 'users']) await env.DB.prepare(`DELETE FROM ${table}`).run();
});
afterEach(() => vi.unstubAllGlobals());
const req = (path: string, data?: unknown, options: { host?: string; cookie?: string; origin?: string; method?: string } = {}) => new Request(`${options.host || 'http://localhost:8787'}${path}`, {
  method: options.method || (data === undefined ? 'GET' : 'POST'),
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.origin ? { Origin: options.origin } : {}) },
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
async function issue(email = 'member@example.com') {
  const response = await handleAuth(req('/api/auth/request', { email }), env); expect(response!.status).toBe(200);
  return (await response!.json() as { developmentCode: string }).developmentCode;
}
const verify = (code: string, email = 'member@example.com') => handleAuth(req('/api/auth/verify', { email, code, nickname: '数据同学' }), env);
const configured = () => ({ ...env, BREVO_API_KEY: 'fake-test-value', EMAIL_FROM: 'coffee@zhaidewei.com' });
async function enqueue(id: string) {
  await env.DB.prepare('INSERT OR IGNORE INTO users(id,email,nickname) VALUES (?,?,?)').bind('member', 'member@example.com', '成员').run();
  await env.DB.prepare('INSERT INTO outbox(id,user_id,subject,body,created_at) VALUES (?,?,?,?,?)').bind(id, 'member', '活动通知', '活动已成团', Date.now()).run();
}
describe('email identity', () => {
  it('only exposes development code on explicit local development', async () => {
    for (const [host, appEnv] of [['https://data-coffee-dev.workers.dev', 'development'], ['http://localhost:8787', 'production']]) {
      const response = await handleAuth(req('/api/auth/request', { email: 'member@example.com' }, { host }), { ...env, APP_ENV: appEnv! });
      expect(response!.status).toBe(503); expect(await response!.text()).not.toContain('developmentCode');
    }
    expect(await issue()).toMatch(/^\d{6}$/);
  });
  it('salts code hashes and permits exactly one concurrent consume; session logs out', async () => {
    const code = await issue();
    const stored = await env.DB.prepare('SELECT code_hash FROM auth_codes').first(); expect(stored!.code_hash).not.toBe(code);
    const responses = await Promise.all([verify(code), verify(code)]); expect(responses.map(r => r!.status).sort()).toEqual([200, 400]);
    const success = responses.find(r => r!.status === 200)!; const cookie = success.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).not.toContain('Secure');
    const me = await handleAuth(req('/api/me', undefined, { cookie }), env); expect((await me!.json() as any).user.email).toBe('member@example.com');
    const logout = await handleAuth(req('/api/auth/logout', {}, { cookie }), env); expect(logout!.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const anonymous = await handleAuth(req('/api/me', undefined, { cookie }), env); expect(await anonymous!.json()).toEqual({ user: null });
  });
  it('locks after five failed guesses and expires codes', async () => {
    const code = await issue(); const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await verify(wrong))!.status).toBe(400);
    expect((await verify(code))!.status).toBe(400);
    const another = await issue('another@example.com'); await env.DB.prepare('UPDATE auth_codes SET expires_at=0').run();
    expect((await verify(another, 'another@example.com'))!.status).toBe(400);
  });
  it('limits requests and rejects cross-origin changes', async () => {
    await issue(); expect((await handleAuth(req('/api/auth/request', { email: 'member@example.com' }), env))!.status).toBe(429);
    expect((await handleAuth(req('/api/auth/logout', {}, { origin: 'https://evil.example' }), env))!.status).toBe(403);
  });
  it('bounds JSON bodies and enforces IP request limits across email addresses', async () => {
    const oversized = await handleAuth(req('/api/auth/request', { email: 'member@example.com', padding: 'x'.repeat(5000) }), env);
    expect(oversized!.status).toBe(400);
    for (let i = 0; i < 20; i++) await issue(`member${i}@example.com`);
    const limited = await handleAuth(req('/api/auth/request', { email: 'next@example.com' }), env);
    expect(limited!.status).toBe(429);
  });
  it('recovers the same account and updates its profile', async () => {
    const login = await verify(await issue()); const cookie = login!.headers.get('Set-Cookie')!; const initial = (await login!.json() as any).user;
    const patch = await handleAuth(req('/api/me', { nickname: '新昵称', publicNickname: true }, { cookie, method: 'PATCH' }), env);
    expect((await patch!.json() as any).user).toEqual({ ...initial, nickname: '新昵称', publicNickname: true });
    await env.DB.prepare('DELETE FROM auth_rate_limits').run(); const next = await verify(await issue()); expect((await next!.json() as any).user.id).toBe(initial.id);
  });
  it('uses secure cookies on HTTPS and hashes session tokens', async () => {
    const code = await issue(); const result = await handleAuth(req('/api/auth/verify', { email: 'member@example.com', code, nickname: '昵称' }, { host: 'https://localhost' }), env);
    const cookie = result!.headers.get('Set-Cookie')!; expect(cookie).toContain('; Secure'); const raw = cookie.split(';')[0]!.split('=')[1]!;
    const session = await env.DB.prepare('SELECT token_hash FROM auth_sessions').first(); expect(session!.token_hash).toBe(await hash(raw)); expect(session!.token_hash).not.toBe(raw);
  });
});
describe('durable email outbox', () => {
  it('claims only once across parallel drains', async () => {
    await enqueue('notice'); const payloads: any[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => { payloads.push(JSON.parse(init.body as string)); return new Response('{}', { status: 201 }); }); vi.stubGlobal('fetch', fetcher);
    await Promise.all([drainMail(configured()), drainMail(configured())]); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(payloads[0].headers.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/); expect((await env.DB.prepare('SELECT status FROM outbox').first())!.status).toBe('sent');
  });
  it('retains safe errors, backs off, and reuses provider key', async () => {
    await enqueue('notice'); const payloads: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { payloads.push(JSON.parse(init.body as string)); return payloads.length === 1 ? new Response('{"message":"PII must not persist"}', { status: 503 }) : new Response('{}', { status: 201 }); }));
    await drainMail(configured()); const failed = await env.DB.prepare('SELECT * FROM outbox').first();
    expect(failed!.status).toBe('failed'); expect(failed!.last_error).toBe('provider_http_503'); expect(Number(failed!.next_attempt)).toBeGreaterThan(Date.now());
    await env.DB.prepare('UPDATE outbox SET next_attempt=0').run(); await drainMail(configured());
    expect(payloads[0].headers.idempotencyKey).toBe(payloads[1].headers.idempotencyKey); expect((await env.DB.prepare('SELECT status FROM outbox').first())!.status).toBe('sent');
  });
  it('reserves OTP quota and atomically enforces the global cap', async () => {
    await enqueue('notice'); await env.DB.prepare('INSERT INTO mail_daily_budget(day,used) VALUES (?,250)').bind(new Date().toISOString().slice(0,10)).run();
    const fetcher = vi.fn(async () => new Response('{}', { status: 201 })); vi.stubGlobal('fetch', fetcher);
    await drainMail(configured()); expect(fetcher).not.toHaveBeenCalled(); await sendEmail(configured(), 'member@example.com', '验证码', '123456'); expect(fetcher).toHaveBeenCalledTimes(1);
    await env.DB.prepare('UPDATE mail_daily_budget SET used=299').run();
    const results = await Promise.allSettled([sendEmail(configured(), 'member@example.com', '验证码', '111111'), sendEmail(configured(), 'member@example.com', '验证码', '222222')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await env.DB.prepare('SELECT used FROM mail_daily_budget').first())!.used).toBe(300);
  });
  it('fails visibly for missing config and stale uncertain deliveries without sending', async () => {
    await enqueue('notice'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await drainMail(env);
    expect((await env.DB.prepare('SELECT last_error FROM outbox').first())!.last_error).toBe('mail_not_configured');
    await env.DB.prepare("UPDATE outbox SET status='sending',claimed_until=0,attempts=1").run();
    await env.DB.prepare('INSERT INTO mail_dispatch VALUES (?,?,?)').bind('notice', crypto.randomUUID(), Date.now()-31*60_000).run(); await drainMail(configured());
    expect((await env.DB.prepare('SELECT last_error FROM outbox').first())!.last_error).toBe('delivery_uncertain_manual_review'); expect(fetcher).not.toHaveBeenCalled();
  });
});

it('邮箱验证无需昵称，首次可后设昵称，老用户保留原昵称',async()=>{
 const code=await issue();const res=await handleAuth(req('/api/auth/verify',{email:'member@example.com',code}),env);
 expect(res!.status).toBe(200);expect((await res!.clone().json() as any).user.nickname).toBe('');
 const cookie=res!.headers.get('set-cookie')!.split(';')[0];
 const saved=await handleAuth(req('/api/me',{nickname:'咖啡同学'},{cookie,method:'PATCH'}),env);expect(saved!.status).toBe(200);
 await env.DB.prepare('DELETE FROM auth_rate_limits').run();
 const again=await issue();const login=await handleAuth(req('/api/auth/verify',{email:'member@example.com',code:again}),env);
 expect(login!.status).toBe(200);expect((await login!.json() as any).user.nickname).toBe('咖啡同学');
});
