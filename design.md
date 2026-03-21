# shuqun

MCP server for 荷兰数据群 — 一个 700 人华人数据/AI 社区的自组织撮合协议。

不建平台，建协议。Agent 是唯一入口，能连上就是能力证明。

## 问题

1. 群内活动组织全靠群主，不可持续
2. 成员的需求和资源没有暴露，大量潜在合作被浪费
3. 700 人的群里，大部分人互相不认识

## 方案

一个开源的 MCP server，社区成员用自己的 Agent（Claude Code / Cursor / 自建）连入。

```
成员的 Agent ──MCP──→ shuqun server ──→ SQLite/Turso
                                    ──→ 微信机器人（周报）
```

**入口即筛选**：能配置 MCP server 的人 = 有基本技术能力 = 目标用户。

## 认证

```
群内发放 invite code → 调用 profile.register(invite_code, nickname) → 管理员审批 → 获得 token
后续连接通过 env var 携带 token
```

不做 OAuth，不做微信登录。invite code 从群里发放 = 群身份证明。

驱逐联动：平台封禁通知群管踢人；群踢人同步冻结 token。

## MCP Tools

### 身份

| Tool | 说明 |
|------|------|
| `profile.register` | 注册，提供 invite_code + 自我介绍（自然语言，server 提取结构化数据） |
| `profile.update` | 更新 profile |
| `profile.get` | 查看某人 profile |

### 撮合

| Tool | 说明 |
|------|------|
| `match.coffee_chat` | 找人 1:1 聊天，输入话题/偏好，返回候选人列表 |
| `match.find_expert` | 找技术咨询，输入技术方向 |
| `match.find_partner` | 找项目搭档，输入项目描述和所需技能 |
| `match.accept` | 接受一个匹配 |
| `match.decline` | 拒绝一个匹配 |
| `match.list_pending` | 查看待处理的匹配请求 |

### 需求 & 资源

| Tool | 说明 |
|------|------|
| `need.post` | 发布需求（自然语言描述，server 分类打标） |
| `need.list` | 浏览活跃需求，支持按类型/技能过滤 |
| `offer.post` | 发布可提供的资源/技能/时间 |
| `offer.list` | 浏览可用资源 |

### 项目

| Tool | 说明 |
|------|------|
| `project.create` | 发起项目，描述目标和所需角色 |
| `project.list` | 浏览开放项目 |
| `project.join` | 申请加入项目 |
| `project.update` | 更新项目状态 |

### 求职内推

| Tool | 说明 |
|------|------|
| `referral.request` | 求内推，输入目标公司/职位 |
| `referral.offer` | 发布内推机会 |
| `referral.list` | 浏览内推信息 |

### 反馈 & 周报

| Tool | 说明 |
|------|------|
| `feedback.submit` | 对完成的匹配提交评价（1-5 星 + 标签） |
| `report.weekly` | 获取最新周报 |

## MCP Resources

| URI | 说明 |
|-----|------|
| `shuqun://directory` | 成员目录（公开 profile 摘要） |
| `shuqun://needs/active` | 当前活跃需求 |
| `shuqun://offers/active` | 当前可用资源 |
| `shuqun://projects/open` | 招募中的项目 |
| `shuqun://report/latest` | 最新周报 |

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

-- 需求
CREATE TABLE needs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  type        TEXT,          -- coffee_chat | consulting | partner | referral | other
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

-- 撮合记录
CREATE TABLE matches (
  id          TEXT PRIMARY KEY,
  user_a      TEXT REFERENCES users(id),
  user_b      TEXT REFERENCES users(id),
  type        TEXT,          -- coffee_chat | consulting | project | referral
  status      TEXT DEFAULT 'pending', -- pending | accepted | declined | completed
  reason      TEXT,          -- 结构化匹配理由
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

-- 反馈
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,
  match_id    TEXT REFERENCES matches(id),
  from_user   TEXT REFERENCES users(id),
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  tags        TEXT,          -- JSON array: ["helpful", "on_time", "insightful"]
  comment     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 撮合策略

Server 不做 AI 推理，只做**结构化筛选 + 排序**，返回候选列表。智能在用户侧的 Agent。

排序信号：
- 同城优先（city match）
- 技能匹配度（tag overlap / complement）
- 时间段重叠（available match）
- 信誉分（avg feedback rating）
- 活跃度（最近登录/操作时间）
- 避免重复配对（历史 match 去重）

返回格式示例：

```json
{
  "candidates": [
    {
      "user_id": "u_abc",
      "nickname": "张三",
      "city": "Amsterdam",
      "skills": ["MLOps", "Kubernetes", "Python"],
      "available": ["weekend_morning"],
      "rating": 4.8,
      "signals": {
        "city_match": true,
        "skill_overlap": ["MLOps"],
        "time_overlap": ["weekend_morning"]
      }
    }
  ]
}
```

## 周报 & 群同步

GitHub Actions 每周日运行：

1. 查询本周新增 match / need / project / feedback
2. 生成 markdown 周报
3. 存入 DB（通过 MCP resource 可读）
4. 调用微信机器人 API 推送到群

## 用户侧配置

```json
{
  "mcpServers": {
    "shuqun": {
      "command": "npx",
      "args": ["shuqun"],
      "env": {
        "SHUQUN_TOKEN": "your-token-here"
      }
    }
  }
}
```

然后直接对 Agent 说话：

```
> 我想找个人聊聊在荷兰做 data engineer 的体验

> 我们公司在招 senior ML engineer，想发个内推

> 有没有人对做一个 Dutch housing price tracker 感兴趣？我需要一个前端

> 这周群里有啥动态？
```

## 项目结构

```
shuqun/
├── src/
│   ├── index.ts              # MCP server 入口
│   ├── tools/
│   │   ├── profile.ts
│   │   ├── match.ts
│   │   ├── need.ts
│   │   ├── offer.ts
│   │   ├── project.ts
│   │   ├── referral.ts
│   │   └── feedback.ts
│   ├── resources/
│   │   ├── directory.ts
│   │   ├── needs.ts
│   │   ├── projects.ts
│   │   └── report.ts
│   ├── auth.ts               # token 校验 + invite code 管理
│   ├── matching.ts           # 结构化匹配逻辑
│   ├── db.ts                 # SQLite / Turso 连接
│   └── types.ts
├── scripts/
│   └── weekly-report.ts      # 周报生成脚本
├── .github/
│   └── workflows/
│       └── weekly-report.yml
├── package.json
├── tsconfig.json
├── design.md                 # 本文档
├── LICENSE                   # MIT
└── README.md
```

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| Runtime | Node.js + TypeScript | MCP SDK 官方支持 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方实现 |
| 数据库 | SQLite (dev) / Turso (prod) | 零运维，单文件起步，Turso 做云端共享 |
| 微信机器人 | WeChatFerry / 企微 webhook | 周报推送 |
| 包发布 | npm (`shuqun`) | `npx shuqun` 一行启动 |
| CI/CD | GitHub Actions | 周报 cron + 发布自动化 |

## MVP 路线

### Phase 1 — 骨架（1 周）

- [ ] MCP server 跑通，能连 Claude Code
- [ ] `profile.register` + `profile.get`
- [ ] `match.coffee_chat`（最小撮合）
- [ ] SQLite 本地存储
- [ ] invite code 认证
- [ ] 发布 npm

### Phase 2 — 可用（+1 周）

- [ ] `need.post` / `need.list` / `offer.post` / `offer.list`
- [ ] `referral.request` / `referral.offer`
- [ ] Turso 云端数据库
- [ ] `report.weekly` + 周报生成脚本

### Phase 3 — 生态（+2 周）

- [ ] `project.create` / `project.join`
- [ ] `feedback.submit` + 信誉分
- [ ] 微信机器人周报推送
- [ ] MCP resources 实现
- [ ] GitHub Actions 自动化

## 设计原则

1. **协议优先**：不建 UI，MCP 是唯一接口
2. **入口即筛选**：能用 Agent + MCP 的人就是目标用户
3. **智能在边缘**：server 返回结构化数据，AI 推理留给用户的 Agent
4. **最小基础设施**：SQLite → Turso，GitHub Actions 做 cron，没有服务器
5. **开源透明**：代码和数据模型全公开，社区可贡献可审计
