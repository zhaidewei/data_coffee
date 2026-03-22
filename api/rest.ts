import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRestRequest } from "../src/rest.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    // Strip /api/rest prefix to get the route path
    const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/^\/api\/rest/, "") || "/";

    // Build query params
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
