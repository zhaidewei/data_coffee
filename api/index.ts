import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../src/db.js";
import { migrate } from "../src/db.js";

let migrated = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!migrated) {
    await migrate();
    migrated = true;
  }

  const db = getDb();

  const usersResult = await db.execute("SELECT COUNT(*) as count FROM users WHERE status = 'active'");
  const coffeesResult = await db.execute("SELECT COUNT(*) as count FROM coffees");
  const openCoffeesResult = await db.execute("SELECT COUNT(*) as count FROM coffees WHERE status = 'open'");

  const userCount = usersResult.rows[0].count;
  const coffeeCount = coffeesResult.rows[0].count;
  const openCoffeeCount = openCoffeesResult.rows[0].count;

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Coffee ☕</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .container {
      max-width: 640px;
      padding: 48px 32px;
      text-align: center;
    }
    h1 {
      font-size: 48px;
      margin-bottom: 8px;
      color: #fff;
    }
    .subtitle {
      font-size: 18px;
      color: #888;
      margin-bottom: 40px;
    }
    .stats {
      display: flex;
      gap: 24px;
      justify-content: center;
      margin-bottom: 48px;
    }
    .stat {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px 32px;
      min-width: 120px;
    }
    .stat-number {
      font-size: 36px;
      font-weight: bold;
      color: #fff;
    }
    .stat-label {
      font-size: 14px;
      color: #888;
      margin-top: 4px;
    }
    .section {
      text-align: left;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .section h2 {
      font-size: 16px;
      color: #fff;
      margin-bottom: 12px;
    }
    .endpoint {
      background: #111;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 12px 16px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      color: #4ade80;
      word-break: break-all;
      margin-bottom: 8px;
    }
    pre {
      background: #111;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      font-size: 12px;
      color: #d4d4d4;
      overflow-x: auto;
      text-align: left;
      line-height: 1.6;
    }
    .description {
      font-size: 14px;
      color: #aaa;
      line-height: 1.6;
    }
    a { color: #4ade80; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer {
      margin-top: 32px;
      font-size: 13px;
      color: #555;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Data Coffee</h1>
    <p class="subtitle">荷兰数据群 MCP Server</p>

    <div class="stats">
      <div class="stat">
        <div class="stat-number">${userCount}</div>
        <div class="stat-label">members</div>
      </div>
      <div class="stat">
        <div class="stat-number">${coffeeCount}</div>
        <div class="stat-label">coffees</div>
      </div>
      <div class="stat">
        <div class="stat-number">${openCoffeeCount}</div>
        <div class="stat-label">open now</div>
      </div>
    </div>

    <div class="section">
      <h2>MCP Endpoint</h2>
      <div class="endpoint">https://data-coffee.vercel.app/api/mcp</div>
      <p class="description">Connect your AI agent (Claude Code, Cursor, etc.) to join the community.</p>
    </div>

    <div class="section">
      <h2>Quick Start</h2>
      <pre>{
  "mcpServers": {
    "data-coffee": {
      "type": "http",
      "url": "https://data-coffee.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}</pre>
    </div>

    <div class="section">
      <h2>How to get a token</h2>
      <p class="description">
        1. Add the MCP server config above (without token first)<br>
        2. Ask your agent: "Register me on data-coffee, nickname: YourName"<br>
        3. Save the returned token into your config<br>
        4. Restart your agent
      </p>
    </div>

    <div class="footer">
      <a href="https://github.com/zhaidewei/data_coffee">GitHub</a>
      &nbsp;·&nbsp;
      Open source &nbsp;·&nbsp; MCP-native &nbsp;·&nbsp; Agent is the only interface
    </div>
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
