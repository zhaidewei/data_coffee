# Data Coffee

MCP server for 荷兰数据群 — 一个 700 人华人数据/AI 社区的自组织撮合协议。

不建平台，建协议。Agent 是唯一入口，能连上就是能力证明。

## 问题

1. 群内活动组织全靠群主，不可持续
2. 成员的需求和资源没有暴露，大量潜在合作被浪费
3. 700 人的群里，大部分人互相不认识

## 方案

一个开源的远程 MCP server，部署在 Vercel 上，社区成员用自己的 Agent（Claude Code / Cursor / 自建）通过 HTTP 连入。

```
成员的 Agent ──MCP (Streamable HTTP)──→ Vercel (data-coffee server)
                                            │
                                            ├──→ Turso (SQLite edge DB)
                                            └──→ 微信机器人（周报）
```

**入口即筛选**：能配置远程 MCP server 的人 = 有基本技术能力 = 目标用户。

## 技术架构

### 为什么 Vercel + 远程 MCP

| 方案 | 优劣 |
|------|------|
| 本地 stdio MCP (npx) | 每人跑一个本地进程，数据各自隔离，无法共享状态 |
| **远程 MCP on Vercel** | 中心化共享数据，零运维，serverless 按量付费，全球边缘加速 |

远程 MCP server 是多人协作的前提——所有人连同一个 server，共享同一份数据。

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│  Vercel                                                 │
│                                                         │
│  ┌───────────────────────────────────────────────┐      │
│  │  api/mcp.ts  (MCP Streamable HTTP endpoint)   │      │
│  │                                               │      │
│  │  ┌─── Auth Middleware (Bearer token) ───┐     │      │
│  │  │                                      │     │      │
│  │  │  MCP Tools    │  MCP Resources       │     │      │
│  │  │  ├─ profile   │  ├─ directory        │     │      │
│  │  │  ├─ coffee    │  ├─ needs/active     │     │      │
│  │  │  ├─ need      │  ├─ projects/open    │     │      │
│  │  │  ├─ offer     │  └─ report/latest    │     │      │
│  │  │  ├─ project   │                      │     │      │
│  │  │  ├─ referral  │                      │     │      │
│  │  │  └─ feedback  │                      │     │      │
│  │  └──────────────────────────────────────┘     │      │
│  └───────────────────┬───────────────────────────┘      │
│                      │                                   │
│  ┌───────────────────┴───────────────────────────┐      │
│  │  api/cron/weekly-report.ts  (Vercel Cron)     │      │
│  └───────────────────────────────────────────────┘      │
└──────────────────────┬──────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
      ┌──────────────┐  ┌──────────────┐
      │  Turso        │  │  微信机器人   │
      │  (libSQL)     │  │  (webhook)   │
      │               │  │              │
      │  edge SQLite  │  │  周报推送    │
      │  全球复制     │  │              │
      └──────────────┘  └──────────────┘
```

### 请求流程

```
Agent 发起 MCP 请求
  → POST https://data-coffee.vercel.app/api/mcp
  → Header: Authorization: Bearer <token>
  → Body: MCP JSON-RPC request
  → Vercel serverless function 处理
  → 查询/写入 Turso
  → 返回 MCP JSON-RPC response
```

## 认证

```
群内发放 invite code → 调用 profile.register(invite_code, nickname) → 管理员审批 → 获得 token
后续请求通过 HTTP Header 携带 Bearer token
```

不做 OAuth，不做微信登录。invite code 从群里发放 = 群身份证明。

驱逐联动：平台封禁通知群管踢人；群踢人同步冻结 token。

## MCP Tools

### 身份

| Tool | 说明 |
|------|------|
| `profile_register` | 注册，提供 invite_code + 自我介绍（自然语言，server 提取结构化数据） |
| `profile_update` | 更新 profile |
| `profile_get` | 查看某人 profile |

### Coffee（多人制）

Coffee 是 Data Coffee 的核心活动形式。不限 1:1，支持多人参与。

| Tool | 说明 |
|------|------|
| `coffee_create` | 发起一场 coffee，设定话题、时间、地点、人数上限 |
| `coffee_list` | 浏览开放的 coffee，按话题/城市/时间过滤 |
| `coffee_join` | 加入一场 coffee |
| `coffee_leave` | 退出一场 coffee |
| `coffee_detail` | 查看某场 coffee 的详情和参与者 |
| `coffee_complete` | 标记 coffee 已完成 |

Coffee 生命周期：

```
open（招募中）→ full（人满）→ confirmed（时间确认）→ completed（已完成）→ feedback
                ↑                                           │
                └── 有人退出时回到 open ──────────────────────┘
```

示例场景：
- "我想约 3-5 人聊聊在荷兰做 data platform 的经验" → `coffee_create(topic, max_size=5)`
- "Amsterdam 这周末有什么 coffee 可以参加？" → `coffee_list(city="Amsterdam")`
- "我也想加入那场聊 MLOps 的 coffee" → `coffee_join(coffee_id)`

### 需求 & 资源

| Tool | 说明 |
|------|------|
| `need_post` | 发布需求（自然语言描述，server 分类打标） |
| `need_list` | 浏览活跃需求，支持按类型/技能过滤 |
| `offer_post` | 发布可提供的资源/技能/时间 |
| `offer_list` | 浏览可用资源 |

### 项目

| Tool | 说明 |
|------|------|
| `project_create` | 发起项目，描述目标和所需角色 |
| `project_list` | 浏览开放项目 |
| `project_join` | 申请加入项目 |
| `project_update` | 更新项目状态 |

### 求职内推

| Tool | 说明 |
|------|------|
| `referral_request` | 求内推，输入目标公司/职位 |
| `referral_offer` | 发布内推机会 |
| `referral_list` | 浏览内推信息 |

### 反馈 & 周报

| Tool | 说明 |
|------|------|
| `feedback_submit` | 对完成的 coffee/匹配提交评价（1-5 星 + 标签） |
| `report_weekly` | 获取最新周报 |

## MCP Resources

| URI | 说明 |
|-----|------|
| `data-coffee://directory` | 成员目录（公开 profile 摘要） |
| `data-coffee://coffees/open` | 当前开放的 coffee |
| `data-coffee://needs/active` | 当前活跃需求 |
| `data-coffee://offers/active` | 当前可用资源 |
| `data-coffee://projects/open` | 招募中的项目 |
| `data-coffee://report/latest` | 最新周报 |

## 数据模型

```sql
-- 用户
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  invite_code TEXT NOT NULL,
  status      TEXT DEFAULT 'pending', -- pending | active | frozen
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Profile（AI 从自然语言自我介绍中提取）
CREATE TABLE profiles (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  city        TEXT,          -- Amsterdam, Rotterdam, Eindhoven, ...
  company     TEXT,
  role        TEXT,          -- Data Engineer, ML Engineer, ...
  skills      TEXT,          -- JSON array: ["Python", "MLOps", "Spark"]
  bio         TEXT,          -- 原始自我介绍
  available   TEXT,          -- JSON array: ["weekday_evening", "weekend"]
  languages   TEXT,          -- JSON array: ["中文", "English", "Nederlands"]
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Coffee（多人活动，核心表）
CREATE TABLE coffees (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT REFERENCES users(id),
  topic       TEXT NOT NULL,
  description TEXT,
  city        TEXT,          -- 线下城市，null 表示线上
  location    TEXT,          -- 具体地点/线上链接
  scheduled_at DATETIME,     -- 计划时间
  max_size    INTEGER DEFAULT 0, -- 0 表示不限人数
  status      TEXT DEFAULT 'open', -- open | full | confirmed | completed | cancelled
  tags        TEXT,          -- JSON array
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coffee_participants (
  coffee_id   TEXT REFERENCES coffees(id),
  user_id     TEXT REFERENCES users(id),
  role        TEXT DEFAULT 'participant', -- creator | participant
  joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (coffee_id, user_id)
);

-- 需求
CREATE TABLE needs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,          -- consulting | partner | referral | other
  description TEXT,
  tags        TEXT,          -- JSON array, AI 提取
  status      TEXT DEFAULT 'open', -- open | matched | closed
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 资源/供给
CREATE TABLE offers (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,
  description TEXT,
  tags        TEXT,
  status      TEXT DEFAULT 'open',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 项目
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT,
  skills_needed TEXT,        -- JSON array
  status      TEXT DEFAULT 'recruiting', -- recruiting | active | completed | archived
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_members (
  project_id  TEXT REFERENCES projects(id),
  user_id     TEXT REFERENCES users(id),
  role        TEXT,
  joined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

-- 内推
CREATE TABLE referrals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,          -- request | offer
  company     TEXT,
  position    TEXT,
  description TEXT,
  status      TEXT DEFAULT 'open',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 反馈（通用，可关联 coffee / project）
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,
  target_type TEXT,          -- coffee | project
  target_id   TEXT,          -- coffee_id or project_id
  from_user   TEXT REFERENCES users(id),
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  tags        TEXT,          -- JSON array: ["helpful", "on_time", "insightful"]
  comment     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 周报存档
CREATE TABLE weekly_reports (
  id          TEXT PRIMARY KEY,
  week_start  DATE NOT NULL,
  content     TEXT NOT NULL,  -- markdown
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 撮合策略

Server 不做 AI 推理，只做**结构化筛选 + 排序**，返回候选列表。智能在用户侧的 Agent。

### Coffee 推荐排序信号

- 话题匹配度（tag overlap）
- 同城优先（city match）
- 时间段重叠（available vs scheduled_at）
- 参与者多样性（技能互补优先，避免同质化）
- 还有空位（max_size - current_size > 0）

### 通用匹配信号

- 技能匹配度（tag overlap / complement）
- 信誉分（avg feedback rating）
- 活跃度（最近操作时间）
- 避免重复配对（历史参与去重）

返回格式示例（coffee_list）：

```json
{
  "coffees": [
    {
      "id": "c_abc",
      "topic": "在荷兰做 Data Platform 的经验",
      "creator": "张三",
      "city": "Amsterdam",
      "scheduled_at": "2026-03-28T14:00:00Z",
      "participants": 3,
      "max_size": 5,
      "tags": ["data-platform", "architecture"],
      "signals": {
        "city_match": true,
        "tag_overlap": ["data-platform"],
        "spots_left": 2
      }
    }
  ]
}
```

## 周报 & 群同步

Vercel Cron Job 每周日运行：

```
api/cron/weekly-report.ts
  → 查询本周: 新 coffee / need / project / referral / feedback
  → 生成 markdown 周报
  → 存入 weekly_reports 表
  → POST 微信机器人 webhook 推送到群
```

`vercel.json` 配置:
```json
{
  "crons": [
    {
      "path": "/api/cron/weekly-report",
      "schedule": "0 10 * * 0"
    }
  ]
}
```

## 用户侧配置

Claude Code (`~/.claude.json`):
```json
{
  "mcpServers": {
    "data-coffee": {
      "type": "url",
      "url": "https://data-coffee.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

Cursor / Claude Desktop:
```json
{
  "mcpServers": {
    "data-coffee": {
      "url": "https://data-coffee.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${DATA_COFFEE_TOKEN}"
      }
    }
  }
}
```

然后直接对 Agent 说话：

```
> 我想约几个人聊聊在荷兰做 data engineer 的体验，最好在 Amsterdam 线下

> 有什么开放的 coffee 可以参加？

> 我们公司在招 senior ML engineer，想发个内推

> 有没有人对做一个 Dutch housing price tracker 感兴趣？我需要一个前端

> 这周群里有啥动态？
```

## 项目结构

```
data_coffee_terminal/
├── api/
│   ├── mcp.ts                # MCP Streamable HTTP endpoint（Vercel serverless）
│   └── cron/
│       └── weekly-report.ts  # Vercel Cron 周报生成
├── src/
│   ├── server.ts             # MCP server 定义（tools + resources）
│   ├── tools/
│   │   ├── profile.ts
│   │   ├── coffee.ts         # coffee 多人活动
│   │   ├── need.ts
│   │   ├── offer.ts
│   │   ├── project.ts
│   │   ├── referral.ts
│   │   └── feedback.ts
│   ├── resources/
│   │   ├── directory.ts
│   │   ├── coffees.ts
│   │   ├── needs.ts
│   │   ├── projects.ts
│   │   └── report.ts
│   ├── auth.ts               # Bearer token 校验 + invite code 管理
│   ├── db.ts                 # Turso (libSQL) 连接
│   └── types.ts
├── vercel.json               # Vercel 配置 + cron
├── package.json
├── tsconfig.json
├── design.md                 # 本文档
├── LICENSE                   # MIT
└── README.md
```

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 托管 | **Vercel** | Serverless，零运维，免费额度够初期用，内置 Cron |
| Runtime | Node.js + TypeScript | MCP SDK 官方支持 + Vercel 原生支持 |
| MCP 传输 | Streamable HTTP | 远程 MCP 标准协议，兼容所有主流 Agent 客户端 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方实现 |
| 数据库 | **Turso** (libSQL) | Edge SQLite，全球复制，免费 500 DB + 9GB，与 Vercel edge 延迟极低 |
| 微信机器人 | 企微 webhook | 周报推送，最简方案 |
| CI/CD | GitHub Actions + Vercel | push 自动部署 |

### Vercel 免费额度（足够初期）

- Serverless 函数：100GB-hours/月
- 带宽：100GB/月
- Cron：每天 1 次（Pro 可更高频）
- 700 人社区的 MCP 请求量远在免费额度内

### Turso 免费额度

- 500 个数据库
- 9GB 总存储
- 10 亿行读取/月
- 2500 万行写入/月

## MVP 路线

### Phase 1 — 骨架（1 周）

- [ ] Vercel 项目初始化 + Turso 数据库
- [ ] `api/mcp.ts` MCP HTTP endpoint 跑通
- [ ] Bearer token 认证
- [ ] `profile_register` + `profile_get`
- [ ] `coffee_create` + `coffee_list` + `coffee_join`（核心）
- [ ] 用 Claude Code 连通测试

### Phase 2 — 可用（+1 周）

- [ ] `need_post` / `need_list` / `offer_post` / `offer_list`
- [ ] `referral_request` / `referral_offer`
- [ ] `report_weekly` + Vercel Cron 周报生成
- [ ] invite code 流程完善

### Phase 3 — 生态（+2 周）

- [ ] `project_create` / `project_join`
- [ ] `feedback_submit` + 信誉分
- [ ] 微信机器人周报推送
- [ ] MCP resources 实现
- [ ] 管理员 tools（冻结用户、生成 invite code）

## 设计原则

1. **协议优先**：不建 UI，MCP 是唯一接口
2. **入口即筛选**：能用 Agent + MCP 的人就是目标用户
3. **智能在边缘**：server 返回结构化数据，AI 推理留给用户的 Agent
4. **Serverless 优先**：Vercel + Turso，零运维，按量付费
5. **开源透明**：代码和数据模型全公开，社区可贡献可审计
6. **Coffee 即社交**：多人 coffee 是核心活动单元，不限于 1:1

---

## 消息系统设计

### 核心思路

**异步邮箱模型**，不是即时通讯。发送者投递，接收者的 Agent 下次交互时拉取。没有 WebSocket，没有推送——符合 serverless + MCP 的架构约束。

成员之间通过 **nickname 寻址**，不暴露 token 或内部 ID。

### 消息类型

| 类型 | 说明 | 场景 |
|------|------|------|
| `direct` | 一对一私信 | "帮我给 Dewei 发条消息" |
| `coffee` | Coffee 群组消息 | "在这个 coffee 里说一下我会迟到 10 分钟" |
| `system` | 系统通知（自动生成） | 有人加入你的 coffee、coffee 被标记完成 |

### 数据库

```sql
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL DEFAULT 'direct',  -- direct | coffee | system
  from_user   TEXT,                             -- sender user_id, NULL for system
  to_user     TEXT,                             -- recipient user_id (direct/system)
  coffee_id   TEXT,                             -- target coffee (coffee type)
  content     TEXT NOT NULL,
  reply_to    TEXT,                             -- parent message id (threading)
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (from_user) REFERENCES users(id),
  FOREIGN KEY (to_user) REFERENCES users(id),
  FOREIGN KEY (coffee_id) REFERENCES coffees(id),
  FOREIGN KEY (reply_to) REFERENCES messages(id)
);

-- 已读状态独立表，支持 coffee 群消息的多人已读
CREATE TABLE IF NOT EXISTS message_reads (
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  read_at     TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**寻址规则**：
- `direct`：`to_user` 必填，`coffee_id` 为空
- `coffee`：`coffee_id` 必填，`to_user` 为空，所有该 coffee 参与者可见
- `system`：`from_user` 为空，`to_user` 必填

### MCP Tools

#### `message_send` — 发送消息

```
参数:
  to:         string?   — 收件人 nickname（direct 必填）
  coffee_id:  string?   — Coffee ID（填了 = 群组消息）
  content:    string    — 消息内容
  reply_to:   string?   — 回复某条消息的 ID

逻辑:
  1. 鉴权：必须登录
  2. to 和 coffee_id 至少填一个
  3. 如果 coffee_id → type = coffee，校验发送者是该 coffee 的参与者
  4. 如果 to → type = direct，通过 nickname 查 to_user
  5. 不能给自己发消息
  6. 写入 messages 表
  7. 如果是 direct，自动生成 system 通知给收件人
  8. 返回 { message_id, type, to/coffee_id }

错误:
  - 未登录
  - 收件人不存在
  - 不是该 coffee 的参与者
  - to 和 coffee_id 都为空
```

#### `message_inbox` — 查看收件箱

```
参数:
  type:       string?   — 过滤: direct | coffee | system（默认全部）
  unread:     boolean?  — 仅未读（默认 false）
  coffee_id:  string?   — 查看某个 coffee 的群组消息
  limit:      number?   — 返回条数（默认 20，最大 50）

逻辑:
  1. 鉴权
  2. 查询条件组合：
     - direct: to_user = 我
     - coffee: 我参与的 coffee 的消息（自动聚合所有 coffee）
     - system: to_user = 我 AND type = system
     - 指定 coffee_id: 只看这个 coffee 的消息
  3. LEFT JOIN message_reads 判断已读状态
  4. 按 created_at DESC 排序
  5. 返回消息列表 + 未读总数

返回:
  {
    messages: [{ id, type, from_nickname, content, coffee_id, coffee_topic, reply_to, read, created_at }],
    unread_count: number
  }
```

#### `message_read` — 标记已读

```
参数:
  message_id:  string?  — 标记单条已读
  coffee_id:   string?  — 标记某 coffee 全部已读
  all:         boolean? — 标记所有未读为已读

逻辑:
  1. 鉴权
  2. INSERT OR IGNORE INTO message_reads (message_id, user_id)
  3. 返回标记数量
```

### 系统通知自动触发

在现有 tool 中插入 system 消息生成逻辑：

| 触发事件 | 通知对象 | 消息模板 |
|----------|----------|----------|
| `coffee_join` | coffee 创建者 | "{nickname} 加入了你的 coffee「{topic}」" |
| `coffee_leave` | coffee 创建者 | "{nickname} 退出了你的 coffee「{topic}」" |
| `coffee_complete` | 所有参与者（除创建者） | "Coffee「{topic}」已完成，欢迎提交反馈" |
| `message_send` (direct) | 收件人 | "{nickname} 给你发了一条私信" |

### Agent 交互示例

```
用户: "帮我给 Alice 发个消息，说下周六的 coffee 我可能迟到"
Agent: → message_send(to: "Alice", content: "下周六的 coffee 我可能迟到")
Agent: ← 已发送给 Alice

用户: "我有新消息吗？"
Agent: → message_inbox(unread: true)
Agent: ← 你有 3 条未读消息：
         1. [私信] Alice: "收到，没关系！" — 5 分钟前
         2. [系统] Bob 加入了你的 coffee「Vibe Coding」 — 1 小时前
         3. [Vibe Coding] Bob: "大家好，期待周六见！" — 1 小时前

用户: "在 vibe coding coffee 群里说一下今天改到线上"
Agent: → message_send(coffee_id: "cof_xxx", content: "今天改到线上，链接稍后发")
Agent: ← 已发送到 coffee 群组（3 位参与者可见）

用户: "标记所有消息已读"
Agent: → message_read(all: true)
Agent: ← 已标记 3 条消息为已读
```

### 实现计划

#### Phase 1 — 基础消息（MVP）
- [ ] `messages` + `message_reads` 表（db.ts migrate）
- [ ] `src/tools/message.ts` 注册到 server
- [ ] `message_send` — 支持 direct + coffee
- [ ] `message_inbox` — 收件箱，支持 type/unread/coffee_id 过滤
- [ ] `message_read` — 标记已读

#### Phase 2 — 系统通知
- [ ] `coffee_join` → 通知创建者
- [ ] `coffee_leave` → 通知创建者
- [ ] `coffee_complete` → 通知所有参与者
- [ ] `message_send` direct → 新消息通知

#### Phase 3 — 增强
- [ ] 消息回复 threading（reply_to 关联 + inbox 展示）
- [ ] `message_delete` — 删除自己发的消息
- [ ] landing page 显示社区消息活跃度统计
