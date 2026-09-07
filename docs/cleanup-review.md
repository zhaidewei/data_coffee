# 清理评审计划

读者：决定清理范围的产品负责人，以及执行删除和验证的维护者。

2026-09-07 本地只读审计，基线 HEAD `67f412d`。本次仅新增本报告，没有删除或改动应用。结论：优先清除两个无调用的详情 renderer；旧项目和评审草稿暂保留。CSS 需要按选择器拆分，不能整段删除。

## 去留建议

| 对象 | 判断与证据 | 建议 |
| --- | --- | --- |
| `app/web/app.js:37–178` 的 `renderDetailLegacy`、`renderDetailPrevious` | 仓库内名称检索仅有定义。页面以 ES module 加载（`app/web/index.html:2`），当前加载、刷新及返回路径调用 `renderDetail`（`app.js:179、288、308`）；没有对旧函数的导出或动态分派。两个函数体只有被调用才执行。 | **建议删除**。当前应用调用图不可达；先保存 diff/commit 以便恢复。 |
| `styles.css:34–36` 的旧 journey 样式 | 多数选择器只服务 Legacy renderer；但 `.journey-lead` 被当前 renderer 的时间节点使用（`app.js:235`）。 | **拆分删除**旧专属选择器，保留共享 `.journey-lead` 及其手机规则；删除前逐项检索并做浏览器核验。不能整块删。 |
| `flow.css` | 全部规则针对 `.code-main-path`；该 DOM 当前只在 Previous renderer 生成（`app.js:164`）。HTML 仍加载它。 | **建议连同 HTML link 删除**，先确认本轮主代理没有重新引入该类。文件为 401 bytes。 |
| `styles.css` 其他 code/parallel 样式 | 当前 renderer 仍使用 code-flow、code-node、parallel 等类；后置覆盖规则涉及手机布局与连接线。 | **保留**。重复名称不等于冗余，先比较 cascade 和媒体查询，不能按文本去重。 |
| `hero()`、`conditionNode()` | 首页异常路径调用 hero（`app.js:289`）；当前详情条件节点调用 conditionNode（`:248`）。 | **保留**。正常首页不出现 hero 不能证明不可达。 |
| 同行、代报名 API | 对 `app/worker`、`app/tests`、`app/cli` 搜索 guest/proxy/invite/retired/removed/410 无命中。`engine.ts:106–206` 当前动作分支包含本人 join/leave、申请、审核等，没有相关退休功能分支。 | **无已确认可删 API**。静态检索不能证明所有未知参数都被拒绝，若需验收退休边界，单独验证 HTTP/engine 拒绝语义。旧项目的 invite code 是注册认证（`src/auth.ts:33`），不应按代报名关键词删除。 |
| 根 `src/`、`api/`、`public/`、package 与 Vercel 配置 | 根 package 的 dev/build 仍编译并启动它们，`tsconfig.json` 包含 src/api；`api/index.ts:1–7` 和 `src/dev.ts:1–7` 有真实依赖链。新应用由 `app/wrangler.jsonc` 独立指向 worker/web/D1；`docs/system-design.md:7` 明确保留旧数据库。 | **待定，继续保留**。可证明与新 Workers 构建分离；不能证明旧服务没有用户或线上部署。删除前需负责人确认退休范围、数据保留及旧地址处置。 |
| 根 README 与 `design.md` | README 仍写无 UI / MCP 唯一入口；`requirements-mvp.md:235` 明确 design 为历史输入；`app/README.md:3` 标记新旧项目边界。 | **建议修复入口文档**：根 README 简述两个目录与当前 MVP 入口；历史 MCP 说明归档保留，不直接删历史设计。 |
| `docs/pending-review.md`、`docs/mockups/` | 本地未跟踪；pending-review 明确讨论后统一实现、风格候选仅供比较。未跟踪不能证明无价值。 | **保留至评审结束**。获选后再决定归档候选，不把未定 Cron 方案写成实现事实。 |
| requirements/system-design/test-cases/development-report | 分别承担产品决定、实现边界、验收及本地结果；不是同一责任。 | **保留并修正过期事实**。开发报告的测试数字及部署状态需要更新证据，不能无验证覆盖。 |

## 收益与执行边界

两个旧 renderer 可减少 **142 行、21,508 bytes**；删除 flow.css 再减少 **401 bytes**，合计候选 **21,909 bytes（约 21.4 KiB，未压缩）**，另可减少 HTML link。旧 journey CSS 整块是 4,206 bytes，但含共享规则，尚不计入确定收益。根旧系统未计入可删除量。

该数字是候选代码净减少量；本轮实际删除为零，报告新增量单独计算。执行时应先应用 renderer 删除，再按使用关系清 CSS，最后修入口文档；不要新增兼容 wrapper 抵消删除收益。

验证需覆盖：活动详情三条并行线与汇合连接、手机/桌面、悬停和固定展开、候选日期、报名/候补/退出、终态只读、首页加载错误、弹窗与助手。再运行 `app` 的 check/test/build；服务端测试成功不能代替 DOM/CSS 验证。与本轮网页编辑合并后重做符号及选择器检索，避免使用过期行号删除。

删除授权依据：本次请求是清理评审。所用 `/Users/zhaidewei/.codex/skills/da-sao-chu/SKILL.md` 明确写明“ 不可以直接删除，大扫除是计划，要有用户的授权门。”因此本报告供确认具体删除范围，不视为已实施清理。

## 执行结果（2026-09-07）
用户已授权清理。已删除两个无调用旧详情 renderer、新总览替换后无调用的旧首页 renderer 及其 eventCard，删除专属 flow.css 与加载引用、styles.css 中 code-main-path 规则。保留当前流程图样式、共享 journey-lead、旧根项目和 mock。验证结果见本轮回归输出。
