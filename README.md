# Data Coffee ☕

An open-source [MCP](https://modelcontextprotocol.io) server for community matching — built for [荷兰数据群](https://github.com/zhaidewei/data_coffee), a 700-person Chinese data/AI professional community in the Netherlands.

**No platform. No UI. Just a protocol.** Your AI agent is the only interface.

## How It Works

```
Your Agent (Claude Code / Cursor / any MCP client)
    │
    │  MCP (Streamable HTTP)
    ▼
Data Coffee Server (Vercel) ──→ Turso (Edge SQLite)
```

Members connect their own AI agents to a shared MCP server. The server exposes structured tools for community matching — coffee chats, resource sharing, job referrals, project teaming.

**The entry point is the filter**: if you can configure an MCP server, you belong here.

## Connect

Add to your MCP client config:

```json
{
  "mcpServers": {
    "data-coffee": {
      "type": "url",
      "url": "https://data-coffee.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

Then talk to your agent naturally:

```
> I want to chat with a few people about doing Data Platform in the Netherlands

> Any open coffee sessions in Amsterdam this weekend?

> Our company is hiring a senior ML engineer, posting a referral

> What happened in the community this week?
```

## Get a Token

1. Get an invite code from the WeChat group (荷兰数据群)
2. Ask your agent to call `profile_register` with the invite code
3. Save the returned token in your MCP config

## Available Tools

### Identity
| Tool | Description |
|------|-------------|
| `profile_register` | Register with an invite code |
| `profile_get` | Look up a member's profile |
| `profile_update` | Update your profile (city, skills, bio, etc.) |

### Coffee (multi-person)
| Tool | Description |
|------|-------------|
| `coffee_create` | Start a coffee session — set topic, city, max size |
| `coffee_list` | Browse open sessions, filter by city or tag |
| `coffee_join` | Join a session |
| `coffee_detail` | View session details and participants |
| `coffee_leave` | Leave a session |
| `coffee_complete` | Mark a session as done |

### Admin
| Tool | Description |
|------|-------------|
| `admin_create_invite_codes` | Generate invite codes |

> More tools (needs, offers, referrals, projects, feedback) coming in Phase 2.

## Development

```bash
# Install
npm install

# Run local dev server (SQLite file, auto-seeds invite codes)
npm run dev

# Server starts at http://localhost:3000/mcp
```

### Local testing with Claude Code

```json
{
  "mcpServers": {
    "data-coffee": {
      "type": "url",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Project Structure

```
├── api/mcp.ts            # Vercel serverless MCP endpoint
├── src/
│   ├── server.ts         # MCP server definition
│   ├── tools/
│   │   ├── profile.ts    # Identity tools
│   │   └── coffee.ts     # Coffee session tools
│   ├── auth.ts           # Token + invite code logic
│   ├── db.ts             # Turso/SQLite + schema migration
│   ├── types.ts          # TypeScript types
│   └── dev.ts            # Local dev server
├── design.md             # Full architecture design doc
└── vercel.json           # Vercel config + cron
```

### Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Node.js + TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Hosting | Vercel (serverless) |
| Database | Turso (edge SQLite) / local SQLite for dev |
| Transport | MCP Streamable HTTP |

## Design

See [design.md](./design.md) for the full architecture, data model, matching strategy, and roadmap.

## Roadmap

- [x] **Phase 1** — MCP server + profile + coffee (multi-person)
- [ ] **Phase 2** — Needs, offers, referrals, weekly report
- [ ] **Phase 3** — Projects, feedback, reputation, WeChat bot

## License

MIT
