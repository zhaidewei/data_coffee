import { getDb } from "./db.js";

const i18n = {
  zh: {
    subtitle: "荷兰数据群 · 用 Agent 连接的社区",
    members: "成员",
    upcoming: "即将开始",
    completed: "已完成",
    upcomingCoffees: "即将开始的 Coffee",
    noCoffees: "暂无活动，用你的 Agent 发起第一场 Coffee 吧！",
    moreCoffees: "更多活动请通过 Agent 查询：对 Agent 说 \"查看所有 coffee\"",
    open: "报名中",
    full: "已满",
    confirmed: "已确认",
    tbd: "时间待定",
    online: "线上",
    spots: (cur: number, max: number) => max > 0 ? `${cur}/${max} 人` : `${cur} 人已报名`,
    creator: "发起人",
    mcpTitle: "MCP 地址",
    mcpDesc: "用你的 AI Agent（Claude Code、Cursor 等）连接，加入社区。",
    quickStart: "快速开始",
    tokenTitle: "如何获取 Token",
    tokenSteps: `1. 先把上面的 MCP 配置加到你的 Agent（不需要填 token）<br>
        2. 对 Agent 说："帮我注册 data-coffee，昵称：你的名字"<br>
        3. 把返回的 token 填入配置<br>
        4. 重启 Agent 即可`,
    yourToken: "你的TOKEN",
    footer: "开源 · MCP 原生 · Agent 是唯一入口",
    switchLang: "EN",
    switchUrl: "?lang=en",
  },
  en: {
    subtitle: "Dutch Data Community · Connected by Agents",
    members: "Members",
    upcoming: "Upcoming",
    completed: "Completed",
    upcomingCoffees: "Upcoming Coffees",
    noCoffees: "No events yet. Use your Agent to create the first Coffee!",
    moreCoffees: "More events available via Agent: ask \"list all coffees\"",
    open: "Open",
    full: "Full",
    confirmed: "Confirmed",
    tbd: "TBD",
    online: "Online",
    spots: (cur: number, max: number) => max > 0 ? `${cur}/${max}` : `${cur} joined`,
    creator: "Host",
    mcpTitle: "MCP Endpoint",
    mcpDesc: "Connect your AI Agent (Claude Code, Cursor, etc.) to join the community.",
    quickStart: "Quick Start",
    tokenTitle: "How to get a Token",
    tokenSteps: `1. Add the MCP config above to your Agent (no token needed)<br>
        2. Ask your Agent: "Register me on data-coffee, nickname: YourName"<br>
        3. Save the returned token into your config<br>
        4. Restart your Agent`,
    yourToken: "YOUR_TOKEN",
    footer: "Open Source · MCP-native · Agent is the only interface",
    switchLang: "中文",
    switchUrl: "?lang=zh",
  },
};

export async function renderLanding(lang: "zh" | "en", mcpUrl: string): Promise<string> {
  const t = i18n[lang];
  const db = getDb();

  const usersResult = await db.execute("SELECT COUNT(*) as count FROM users WHERE status = 'active'");
  const upcomingResult = await db.execute(
    "SELECT COUNT(*) as count FROM coffees WHERE status IN ('open', 'full', 'confirmed') AND (scheduled_at IS NULL OR scheduled_at > datetime('now'))"
  );
  const completedResult = await db.execute(
    "SELECT COUNT(*) as count FROM coffees WHERE status = 'completed'"
  );

  const userCount = usersResult.rows[0].count;
  const upcomingCount = upcomingResult.rows[0].count as number;
  const completedCount = completedResult.rows[0].count;

  const coffeesResult = await db.execute(
    `SELECT c.*, u.nickname AS creator_name,
       (SELECT COUNT(*) FROM coffee_participants cp WHERE cp.coffee_id = c.id) AS participant_count
     FROM coffees c
     JOIN users u ON c.creator_id = u.id
     WHERE c.status IN ('open', 'full', 'confirmed')
       AND (c.scheduled_at IS NULL OR c.scheduled_at > datetime('now'))
     ORDER BY CASE WHEN c.scheduled_at IS NOT NULL THEN 0 ELSE 1 END, c.scheduled_at ASC, c.created_at DESC
     LIMIT 10`
  );

  const statusMap = { open: t.open, full: t.full, confirmed: t.confirmed };
  const statusColorMap: Record<string, string> = { open: "#4ade80", full: "#f59e0b", confirmed: "#3b82f6" };

  const coffeeListHtml = coffeesResult.rows.length > 0
    ? coffeesResult.rows.map((row) => {
        const scheduledAt = row.scheduled_at
          ? new Date(row.scheduled_at as string).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", {
              month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit",
            })
          : t.tbd;
        const city = row.city || t.online;
        const spots = t.spots(row.participant_count as number, row.max_size as number);
        const status = row.status as string;
        return `
      <div class="coffee-card">
        <div class="coffee-header">
          <span class="coffee-topic">${row.topic}</span>
          <span class="coffee-status" style="color:${statusColorMap[status] || "#4ade80"}">${(statusMap as any)[status] || status}</span>
        </div>
        <div class="coffee-meta">
          <span>📅 ${scheduledAt}</span>
          <span>📍 ${city}</span>
          <span>👥 ${spots}</span>
        </div>
        ${row.description ? `<div class="coffee-desc">${row.description}</div>` : ""}
        <div class="coffee-creator">${t.creator}: ${row.creator_name}</div>
      </div>`;
      }).join("") + (upcomingCount > 10 ? `<div class="more">${t.moreCoffees}</div>` : "")
    : `<div class="empty">${t.noCoffees}</div>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Coffee</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 640px;
      padding: 48px 32px;
      text-align: center;
    }
    .top-bar {
      text-align: right;
      margin-bottom: 16px;
    }
    .lang-switch {
      font-size: 13px;
      color: #4ade80;
      text-decoration: none;
      border: 1px solid #333;
      padding: 4px 12px;
      border-radius: 4px;
    }
    .lang-switch:hover { background: #1a1a1a; }
    h1 { font-size: 48px; margin-bottom: 8px; color: #fff; }
    .subtitle { font-size: 18px; color: #888; margin-bottom: 40px; }
    .stats { display: flex; gap: 24px; justify-content: center; margin-bottom: 48px; }
    .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px 32px; min-width: 120px; }
    .stat-number { font-size: 36px; font-weight: bold; color: #fff; }
    .stat-label { font-size: 14px; color: #888; margin-top: 4px; }
    .section { text-align: left; background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .section h2 { font-size: 16px; color: #fff; margin-bottom: 16px; }
    .endpoint { background: #111; border: 1px solid #444; border-radius: 8px; padding: 12px 16px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; color: #4ade80; word-break: break-all; margin-bottom: 8px; }
    pre { background: #111; border: 1px solid #444; border-radius: 8px; padding: 16px; font-size: 12px; color: #d4d4d4; overflow-x: auto; text-align: left; line-height: 1.6; }
    .description { font-size: 14px; color: #aaa; line-height: 1.6; }
    a { color: #4ade80; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer { margin-top: 32px; font-size: 13px; color: #555; }
    .coffee-card { background: #111; border: 1px solid #333; border-radius: 8px; padding: 16px; margin-bottom: 12px; text-align: left; }
    .coffee-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .coffee-topic { font-size: 15px; font-weight: 600; color: #fff; }
    .coffee-status { font-size: 12px; font-weight: 500; }
    .coffee-meta { display: flex; gap: 16px; font-size: 13px; color: #999; margin-bottom: 8px; flex-wrap: wrap; }
    .coffee-desc { font-size: 13px; color: #888; margin-bottom: 8px; line-height: 1.5; }
    .coffee-creator { font-size: 12px; color: #666; }
    .empty { text-align: center; color: #666; padding: 24px; font-size: 14px; }
    .more { text-align: center; color: #888; padding: 12px; font-size: 13px; border-top: 1px solid #222; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <a class="lang-switch" href="${t.switchUrl}">${t.switchLang}</a>
    </div>
    <h1>Data Coffee</h1>
    <p class="subtitle">${t.subtitle}</p>

    <div class="stats">
      <div class="stat">
        <div class="stat-number">${userCount}</div>
        <div class="stat-label">${t.members}</div>
      </div>
      <div class="stat">
        <div class="stat-number">${upcomingCount}</div>
        <div class="stat-label">${t.upcoming}</div>
      </div>
      <div class="stat">
        <div class="stat-number">${completedCount}</div>
        <div class="stat-label">${t.completed}</div>
      </div>
    </div>

    <div class="section">
      <h2>${t.upcomingCoffees}</h2>
      ${coffeeListHtml}
    </div>

    <div class="section">
      <h2>${t.mcpTitle}</h2>
      <div class="endpoint">${mcpUrl}</div>
      <p class="description">${t.mcpDesc}</p>
    </div>

    <div class="section">
      <h2>${t.quickStart}</h2>
      <pre>{
  "mcpServers": {
    "data-coffee": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${t.yourToken}"
      }
    }
  }
}</pre>
    </div>

    <div class="section">
      <h2>${t.tokenTitle}</h2>
      <p class="description">${t.tokenSteps}</p>
    </div>

    <div class="footer">
      <a href="https://github.com/zhaidewei/data_coffee">GitHub</a>
      &nbsp;&middot;&nbsp;
      ${t.footer}
    </div>
  </div>
</body>
</html>`;
}
