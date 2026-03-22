import { profileRegister, profileGet, profileUpdate, adminCreateInviteCodes } from "./services/profile.js";
import { coffeeCreate, coffeeList, coffeeJoin, coffeeDetail, coffeeLeave, coffeeUpdate, coffeeComplete } from "./services/coffee.js";
import { messageSend, messageInbox, messageRead } from "./services/message.js";
import { validateToken, extractBearerToken } from "./auth.js";
import { migrate } from "./db.js";
import { getOpenApiSpec } from "./openapi.js";

let migrated = false;

interface RestRequest {
  method: string;
  pathname: string;
  body: Record<string, unknown>;
  query: Record<string, string>;
  headers: { authorization?: string };
}

interface RestResponse {
  status: number;
  data: unknown;
}

/** Extract userId from Authorization header, returns null if not authenticated */
async function authenticate(headers: { authorization?: string }): Promise<string | null> {
  const token = extractBearerToken(headers.authorization ?? null);
  if (!token) return null;
  const result = await validateToken(token);
  return result?.userId ?? null;
}

/** Require authentication, returning an error response if not authenticated */
function requireAuth(userId: string | null): RestResponse | null {
  if (!userId) {
    return { status: 401, data: { error: "Authentication required. Provide Bearer token in Authorization header." } };
  }
  return null;
}

/** Route a REST request to the appropriate service function */
export async function handleRestRequest(req: RestRequest): Promise<RestResponse> {
  if (!migrated) {
    await migrate();
    migrated = true;
  }

  const { method, pathname, body, query, headers } = req;
  const userId = await authenticate(headers);

  // Helper to match routes like /coffee/:id/join
  const match = (m: string, pattern: string): Record<string, string> | null => {
    if (method !== m) return null;
    const patternParts = pattern.split("/");
    const pathParts = pathname.split("/");
    if (patternParts.length !== pathParts.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) {
        params[patternParts[i].slice(1)] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  };

  let m: Record<string, string> | null;

  // ── OpenAPI Spec ──

  if ((m = match("GET", "/openapi.json"))) {
    // Derive base URL from request context; caller can override via ?base_url=
    const baseUrl = query.base_url || "";
    return { status: 200, data: getOpenApiSpec(baseUrl) };
  }

  // ── Profile ──

  if ((m = match("POST", "/profile/register"))) {
    const data = await profileRegister({
      nickname: body.nickname as string,
      bio: body.bio as string,
    });
    return { status: 201, data };
  }

  if ((m = match("GET", "/profile"))) {
    if (!query.query) return { status: 400, data: { error: "query parameter is required" } };
    const data = await profileGet({ query: query.query });
    return { status: 200, data };
  }

  if ((m = match("PUT", "/profile"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await profileUpdate(body as any, userId!);
    return { status: 200, data };
  }

  if ((m = match("POST", "/admin/invite-codes"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await adminCreateInviteCodes({ count: body.count as number }, userId!);
    return { status: 201, data };
  }

  // ── Coffee ──

  if ((m = match("POST", "/coffee"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await coffeeCreate(body as any, userId!);
    return { status: 201, data };
  }

  if ((m = match("GET", "/coffee"))) {
    const data = await coffeeList({
      city: query.city,
      tag: query.tag,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
    return { status: 200, data };
  }

  if ((m = match("GET", "/coffee/:id"))) {
    const data = await coffeeDetail({ coffee_id: m.id });
    return { status: 200, data };
  }

  if ((m = match("PUT", "/coffee/:id"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await coffeeUpdate({ coffee_id: m.id, ...body as any }, userId!);
    return { status: 200, data };
  }

  if ((m = match("POST", "/coffee/:id/join"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await coffeeJoin({ coffee_id: m.id }, userId!);
    return { status: 200, data };
  }

  if ((m = match("POST", "/coffee/:id/leave"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await coffeeLeave({ coffee_id: m.id }, userId!);
    return { status: 200, data };
  }

  if ((m = match("POST", "/coffee/:id/complete"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await coffeeComplete({ coffee_id: m.id }, userId!);
    return { status: 200, data };
  }

  // ── Message ──

  if ((m = match("POST", "/message"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await messageSend(body as any, userId!);
    return { status: 201, data };
  }

  if ((m = match("GET", "/message/inbox"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await messageInbox({
      type: (query.type as any) || undefined,
      unread: query.unread === "true",
      coffee_id: query.coffee_id,
      limit: query.limit ? parseInt(query.limit) : undefined,
    }, userId!);
    return { status: 200, data };
  }

  if ((m = match("POST", "/message/read"))) {
    const err = requireAuth(userId);
    if (err) return err;
    const data = await messageRead(body as any, userId!);
    return { status: 200, data };
  }

  return { status: 404, data: { error: "Not found" } };
}
