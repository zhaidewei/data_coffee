# Data Coffee Web MVP

读者：接手开发、部署和验收的维护者。这里是当前 Cloudflare Workers + D1 应用。旧 Vercel MCP 代码入口已退休，旧数据库不在本应用迁移范围内。

## 本地启动

使用 Node.js 22 或更新的受支持版本，在本目录执行：

```sh
npm ci
npm run db:local
npm run db:seed:local
npm run dev
```

访问 http://localhost:8787 。本地数据库在 `.wrangler/`。`db:seed:local` 可重复执行，创建 Alice、Bob、Chen、Dana 四个账号，以及征集中、草稿和已成行活动。使用 `alice@data-coffee.local` 等邮箱登录时，登录表单会直接显示开发验证码；切换账号时先退出当前账号。本地数据不会同步到云端。

保持本地服务运行时，执行 `npm run simulate:local` 可让四个模拟账号经真实本地 API 完成创建、报名、候补、申请、审批、成行、补齐和结束，并在本地数据库保留最终活动供页面检查。

验证：`npm run check`、`npm test`、`npm run build`。build 只是 Workers dry-run，不部署。依赖版本及 lockfile 固定；Miniflare 当前测试运行器为 5.20260903.0-alpha，未用于线上运行。

## 发布与读回

`npm run release:preflight` 要求工作树干净、当前位于 `main`、HEAD 与刷新后的 `origin/main` 完全一致。`origin` 和 `gh repo view` 都必须解析为 canonical `zhaidewei/data_coffee`；GitHub protection 必须对管理员生效、要求 PR review、没有 review bypass，并把 `App Worker` 配为 required check。当前 SHA 还必须来自一个已合并到 `main` 的 PR，且 required GitHub App 对应的最新 check 已成功。随后脚本直接读取远端 D1 migration 记录；有待应用 migration 或远端出现当前代码没有的 migration 时停止。它不应用 migration。

首次启用时，先把 CI workflow 合并到远端，让 GitHub 至少运行一次 `App Worker`，再在 branch protection 中把该 check 设为 required；完成前 preflight 会按设计拒绝发布。发布机需安装并登录 `gh` 与 Wrangler CLI，两者仅使用各自现有凭据，脚本不读取或打印凭据。

`npm run deploy:dev` 依次执行 preflight、`npm ci`、类型检查、测试和 dry-run build，再次核对 Git 与 D1 后才调用 Wrangler。部署把完整 Git SHA 写入 `APP_VERSION` 和 Worker 版本说明。`/api/health` 返回该版本；配置里的 `APP_VERSION=local` 仅作为绕过发布脚本时的明显占位值。

部署后脚本只读回 canonical production URL，并要求 health 环境为 `production`；`DATA_COFFEE_BASE_URL` 不影响部署。它核对 `/api/health`、读取 `/api/events?page=1&pageSize=1` 验证 pagination 元数据，并通过只读 D1 查询输出 outbox 状态计数及已到期活动数量。活动列表 API 会按现有业务规则先结算到期活动，因此这一步可能推进活动状态和生成通知；单页读取可避免为读回反复扫描。脚本输出不包含活动正文、用户、邮箱、邮件内容或密钥。也可单独执行 `npm run release:readback -- --expected-version <40位Git SHA>`；只有这个独立 readback 接受 `DATA_COFFEE_BASE_URL` 或 `--base-url` 指定另一个不含凭据的 HTTPS 地址。

CI 会比较当前提交与 PR base（push 到 `main` 时使用 push 前 SHA）：`app/migrations/` 只允许新增文件，修改、删除或重命名已经存在的 migration 都会失败。首次 push 没有有效 base SHA 时跳过该项。

## CLI 与 Agent 调用

读者：通过终端或 Agent 操作活动的维护者与用户。CLI 使用网页相同的 HTTP API、用户身份及权限检查，优先使用个人访问令牌。Node.js 22+ 即可，无新增运行依赖；在本目录运行 `npm run cli -- --help`，脚本集成建议直接使用 `node cli/dc-flow.mjs`，避免 npm 输出干扰 JSON。

```sh
node cli/dc-flow.mjs events list
node cli/dc-flow.mjs events get EVENT_ID
node cli/dc-flow.mjs events create --data @draft.json
node cli/dc-flow.mjs events action EVENT_ID publish --version 0 --key publish-unique-001
```

`--base-url` 或 `DATA_COFFEE_BASE_URL` 指定服务地址，默认本地 `http://localhost:8787`；远端必须 HTTPS。`--data` 接收 JSON、`@文件` 或 `-`（stdin）。草稿结构与 `/api/events` POST 一致，动作附加字段与 `/api/events/:id/actions` 一致；CLI 不绕过服务端校验。所有修改动作显式提供当前 `version` 与唯一 `--key`；冲突退出码 4，需要重新读取并判断。未知结果重试同一次动作时复用原始 key 和参数；创建草稿 API 尚无幂等支持，超时后先查询活动列表，避免重复创建。CLI 不自动重试。

推荐认证：在网页登录后创建个人访问令牌，通过 `DATA_COFFEE_TOKEN` 或 `--token-stdin` 注入。令牌格式为 `dcf_` 加 64 位小写十六进制字符，CLI 通过 `Authorization: Bearer` 发送。Agent 使用本地 `secret` CLI 在调用点读取，将输出管道接到 `node cli/dc-flow.mjs auth me --token-stdin`；具体读取参数以本机 `secret` 帮助为准。不要将明文令牌放入命令参数、日志或文件。CLI 不保存令牌；两个 token 来源同时提供、或 token 与会话同时提供时拒绝执行。`--token-stdin` 不能与 `--data -` 同用，动作请求体可用 `@文件`。

邮箱登录保留作为备用：`auth request --data ...` 的 JSON 为 `{email}`，该命令会向目标服务请求真实验证码；`auth verify --data -` 接收 `{email,code,nickname}`。普通验证输出只含用户；显式 `--session-only` 输出 `{sessionToken}` 供管道捕获。会话仅经 `DATA_COFFEE_SESSION` 或 `--session-stdin` 注入；后者接收原始 token 或该 JSON。使用本地 `secret` CLI 在调用点读取并通过管道注入，不把会话、验证码写进命令参数、文档或文件。认证请求体优先 stdin，不能同时让会话和请求体占用 stdin。CLI 不保存会话。`auth me` 查询本人；`auth logout` 注销当前会话。

成功输出为 stdout JSON；错误为 stderr JSON。退出码：0 成功，1 网络或 API 错误，2 参数错误，3 认证/权限错误，4 版本冲突。请求超时 30 秒，拒绝 HTTP 重定向。活动列表遵循服务端分页及草稿可见性规则；当前不支持删除已发布活动和自动登录刷新。测试通过 mock HTTP 验证参数和错误通道，不发送真实邮件。

## 云端开发环境准备

当前测试环境为 https://data-coffee-dev.dewei-zhai.workers.dev ，`wrangler.jsonc` 已绑定对应的独立 D1 数据库。迁移 0001–0006 已应用。另建环境时需创建自己的数据库并替换绑定及 `APP_URL`，再执行迁移和部署。

发信配置：`EMAIL_FROM` 使用已在 Brevo 验证的发件人；当前测试环境使用配置中的 Gmail 发件地址，`EMAIL_FROM_NAME` 可为 Data Coffee。`BREVO_API_KEY` 和 `DEEPSEEK_API_KEY` 使用 Worker secrets；通过本地 secret CLI 在使用点读取后直接管道注入，不写入仓库、.dev.vars 或文档。`DEEPSEEK_MODEL` 可覆盖默认模型。

未配置 Brevo 的云端登录返回明确错误，不提供测试验证码；未配置 DeepSeek 时普通按钮仍可用。当前已部署云端测试环境，用户已确认收到验证码并成功登录；这不代表邮件容量、全部通知路径或模型功能已完成验收。

## 维护与故障定位

- 每分钟 Cron 处理最多20个到期活动，再处理最多10封通知；页面读取和写操作也先补做活动结算。页面可见时每30秒检查活动状态。时钟倒计时不代表后台已提交结算。
- D1 `activities` 为活动状态，`audit` 为操作索引，介绍修订前后正文在活动 receipts 中；`outbox` 为通知状态。邮箱及申请详情属于私有数据，不导出至公共日志。
- `outbox.sent` 表示服务商已接收。失败原因采用安全代码；网络结果不确定超过25分钟后停止自动重发，由维护者核对 Brevo 接收记录。不要直接清空幂等信息重发。
- 日额度默认配置280次，并为登录邮件预留余量；700人同时需要通知可能跨日排队，页面状态即时可查。验证码过期为10分钟，会话为30天。
- 查看安全的队列汇总：`SELECT status, COUNT(*) FROM outbox GROUP BY status;`。检查到期积压：`SELECT COUNT(*) FROM activities WHERE next_due <= unixepoch()*1000;`。
- 上线前实测 Workers Free CPU、D1调用/存储和邮件预算，验证 Cron、真实收件、失败恢复及域名。当前自动化测试不能证明远端10ms预算达标。

## 产品边界

仅本人报名；不收款。金额为资源意向。发布时锁规则；最低人数一直保持同一门槛。正式报名者在开始前可退出并按规则递补、补齐；候补在进行中仍可退出，发布者仍可紧急取消。取消或完成后终态只读。

活动链接和二维码分享图由浏览器本地生成。报名留言随参与名单公开展示；发起人可通过 `reply_registration` 公开回复，回复会通知留言者。活动采用分布式协作决策：成员分别提交或撤回报名、时间偏好、场地和现场负责人，系统持续按发布时锁定的规则判断，发布不保证最终成行。

一期场地申请表示承诺覆盖整场活动时段，审核人核对容量、地址及可用性。当前不做场地日历或按小时分段匹配。

验收主清单和实现设计位于上一层 `docs/`。付款、真实发信和远端运行验证均需独立记录结果。
