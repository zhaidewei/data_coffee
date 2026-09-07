# Data Coffee Web MVP

读者：接手开发、部署和验收的维护者。这里是独立的 Cloudflare Workers + D1 应用，旧项目入口保留。

## 本地启动

使用 Node.js 22 或更新的受支持版本，在本目录执行：

```sh
npm ci
npm run db:local
npm run dev
```

访问 http://localhost:8787 。本地数据库在 `.wrangler/`。仅 development 模式且 localhost/127.0.0.1、未配置 Brevo 时，登录表单显示测试验证码；使用虚构邮箱即可。本地数据不会同步到云端。

验证：`npm run check`、`npm test`、`npm run build`。build 只是 Workers dry-run，不部署。依赖版本及 lockfile 固定；Miniflare 当前测试运行器为 5.20260903.0-alpha，未用于线上运行。

## 云端开发环境准备

开发网址使用 Workers 提供的 workers.dev 地址。`wrangler.jsonc` 的 D1 ID 当前是占位符，不能当作已配置环境。需在目标 Cloudflare 账号创建独立开发数据库，将真实 ID 写入绑定，再执行远程迁移和部署。`APP_URL` 配置为实际 HTTPS 地址。

发信配置：`EMAIL_FROM` 必须是已在 Brevo 验证的 zhaidewei.com 邮箱，`EMAIL_FROM_NAME` 可为 Data Coffee。`BREVO_API_KEY` 和 `DEEPSEEK_API_KEY` 使用 Worker secrets；通过本地 secret CLI 在使用点读取后直接管道注入，不写入仓库、.dev.vars 或文档。`DEEPSEEK_MODEL` 可覆盖默认模型。

未配置 Brevo 的云端登录返回明确错误，不提供测试验证码；未配置 DeepSeek 时普通按钮仍可用。当前尚未执行云端部署或真实邮件/模型验收。

## 维护与故障定位

- 每分钟 Cron 处理最多20个到期活动，再处理最多10封通知；页面读取和写操作也先补做活动结算。页面可见时每30秒检查活动状态。时钟倒计时不代表后台已提交结算。
- D1 `activities` 为活动状态，`audit` 为操作索引，介绍修订前后正文在活动 receipts 中；`outbox` 为通知状态。邮箱及申请详情属于私有数据，不导出至公共日志。
- `outbox.sent` 表示服务商已接收。失败原因采用安全代码；网络结果不确定超过25分钟后停止自动重发，由维护者核对 Brevo 接收记录。不要直接清空幂等信息重发。
- 日额度默认配置280次，并为登录邮件预留余量；700人同时需要通知可能跨日排队，页面状态即时可查。验证码过期为10分钟，会话为30天。
- 查看安全的队列汇总：`SELECT status, COUNT(*) FROM outbox GROUP BY status;`。检查到期积压：`SELECT COUNT(*) FROM activities WHERE next_due <= unixepoch()*1000;`。
- 上线前实测 Workers Free CPU、D1调用/存储和邮件预算，验证 Cron、真实收件、失败恢复及域名。当前自动化测试不能证明远端10ms预算达标。

## 产品边界

仅本人报名；不收款。金额为资源意向。发布时锁规则；最低人数一直保持同一门槛。正式报名者在开始前可退出并按规则递补、补齐；候补在进行中仍可退出，发布者仍可紧急取消。取消或完成后终态只读。

一期场地申请表示承诺覆盖整场活动时段，审核人核对容量、地址及可用性。当前不做场地日历或按小时分段匹配。

验收主清单和实现设计位于上一层 `docs/`。付款、真实发信和远端运行验证均需独立记录结果。
