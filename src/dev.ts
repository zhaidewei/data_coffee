import { createServer as createHttpServer } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { validateToken, extractBearerToken, createInviteCodes } from "./auth.js";
import { getDb, migrate } from "./db.js";
import { renderLanding } from "./landing.js";

const PORT = parseInt(process.env.PORT || "3000");

await migrate();

// Seed initial invite codes for testing
const codes = await createInviteCodes(5, null);
console.log("Seeded invite codes:", codes);

const httpServer = createHttpServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Landing page
  const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
    try {
      const lang = parsedUrl.searchParams.get("lang") === "en" ? "en" : "zh";
      const html = await renderLanding(lang, `http://localhost:${PORT}/mcp`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      console.error("Landing page error:", err);
      res.writeHead(500);
      res.end("Internal error");
    }
    return;
  }

  // Only handle /mcp
  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Auth
  const token = extractBearerToken(req.headers.authorization ?? null);
  if (token) {
    const authResult = await validateToken(token);
    if (authResult) {
      (req as any).auth = {
        token,
        clientId: authResult.userId,
        scopes: [],
        extra: {
          userId: authResult.userId,
          status: authResult.status,
        },
      };
    }
  }

  // Parse body for POST
  let body: unknown = undefined;
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }
  }

  const server = await createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`Data Coffee MCP server running at http://localhost:${PORT}/mcp`);
});
