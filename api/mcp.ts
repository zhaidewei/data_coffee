import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../src/server.js";
import { validateToken, extractBearerToken } from "../src/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Auth: extract token and attach to request
  const token = extractBearerToken(req.headers.authorization ?? null);

  // Allow unauthenticated access for initialize and profile_register
  // but attach auth info if token is present
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

  // Create stateless MCP server + transport per request
  const server = await createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
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
