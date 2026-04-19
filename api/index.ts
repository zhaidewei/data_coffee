import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../src/server.js";
import { validateToken, extractBearerToken } from "../src/auth.js";
import { handleRestRequest } from "../src/rest.js";
import { migrate } from "../src/db.js";
import { renderLanding } from "../src/landing.js";

let migrated = false;
let cachedServer: Awaited<ReturnType<typeof createServer>> | null = null;

async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}

async function getMcpServer() {
  await ensureMigrated();
  if (!cachedServer) {
    cachedServer = await createServer();
  }
  return cachedServer;
}

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
}

// ── Landing page handler ──
async function handleLanding(req: VercelRequest, res: VercelResponse) {
  await ensureMigrated();
  const lang = req.query.lang === "en" ? "en" : "zh";
  const html = await renderLanding(lang, "https://data-coffee.vercel.app/api/mcp");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

// ── MCP handler ──
async function handleMcp(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const token = extractBearerToken(req.headers.authorization ?? null);
  if (token) {
    const authResult = await validateToken(token);
    if (authResult) {
      (req as any).auth = {
        token,
        clientId: authResult.userId,
        scopes: [],
        extra: { userId: authResult.userId, status: authResult.status },
      };
    }
  }

  const server = await getMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: String(err) },
        id: null,
      });
    }
  }
}

// ── REST handler ──
async function handleRest(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/^\/api\/rest/, "") || "/";
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });

    const result = await handleRestRequest({
      method: req.method || "GET",
      pathname,
      body: req.body || {},
      query,
      headers: { authorization: req.headers.authorization },
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    console.error("REST handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

// ── Single entry point: route by URL path ──
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pathname = req.url?.split("?")[0] || "/";

  if (pathname === "/api/mcp" || pathname === "/mcp") {
    return handleMcp(req, res);
  }

  if (pathname.startsWith("/api/rest/") || pathname.startsWith("/api/rest")) {
    return handleRest(req, res);
  }

  // Default: landing page
  return handleLanding(req, res);
}
