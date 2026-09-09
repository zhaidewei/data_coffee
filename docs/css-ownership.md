# 前端 CSS 维护指南

读者是修改 Data Coffee 页面和组件的维护者。这里说明样式应写在哪里，以及如何确认整理样式没有改变界面。

## 样式归属

`index.html` 继续按原顺序加载结构样式、总览结构、地图、控制台组件、浅色主题。`console.css` 只作为组件入口，避免继续在文件末尾追加覆盖规则。

| 文件 | 负责的内容 |
| --- | --- |
| `app/web/styles.css` | 共用 HTML 元素、表单、对话框及已有页面结构；保持既有兼容结构 |
| `app/web/overview.css` | 总览布局和流程图基础几何 |
| `app/web/map.css` | 地图内部布局、标记与地图断点 |
| `app/web/css/foundation.css` | 当前深色默认变量、共用控件外观、标签和进度 |
| `app/web/css/navigation.css` | 导航栏、移动端顶栏和测试阶段提示 |
| `app/web/css/activity.css` | 活动流程图、状态配色、节点和节点对话框 |
| `app/web/css/forms.css` | 人数滑杆、城市选择、日期与表单组件 |
| `app/web/css/detail.css` | 活动决策、报名入口、留言和分享 |
| `app/web/css/overview.css` | 总览筛选、卡片、日历与地图容器外观 |
| `app/web/css/account.css` | 账户菜单、token 管理和 CLI 文档 |
| `app/web/light.css` | 浅色主题覆盖，保持最后加载 |

组件文件先放基础规则，再集中放该组件的媒体规则；相同断点在同一组件内只出现一次。跨组件相同断点各自归属对应组件，无需另建全局手机补丁文件。新增样式优先修改已有选择器，避免在入口末尾追加覆盖。

组件入口顺序是级联契约：`detail` 在 `overview` 之前，让同时具有 `decision-note overview-intro` 的总览介绍保留原有宽度和边距。活动节点的 `:focus-visible` 位于媒体规则之后，保留手机选中节点的 3px 焦点宽度与偏移。不要仅依据“媒体规则放最后”移动这类联合状态。

## 清理范围与保留项

旧 sidebar 的选择器已无 HTML/JS 消费，已从总览结构和控制台样式中删除。本轮合并了导航、卡片、标签、分享预览等重复声明。`range-limits` 与旧 DAG deadline/timebar 在基线 main 中已被删除，本轮保留其删除结果。

`.overview-card-visual:has(.city-coffee)` 仍匹配当前嵌套图片，继续保留。未借整理样式调整布局、断点值或业务行为。`styles.css` 的既有兼容结构仍然存在，后续删除需要单独核对消费证据。

## 浏览器回归

在 `app` 目录先执行 `npm ci`。浏览器检查使用 devDependency 中的 Playwright；默认使用本机 Chrome。CI 或没有 Chrome 的环境可执行 `npx playwright install chromium`，并用 `CSS_SMOKE_CHANNEL=chromium npm run test:css`。

```sh
npm run check
npm test
npm run build
npm run test:css
```

检查启动只绑定本机的随机端口，使用固定 API fixture，不连接业务服务或真实账号。覆盖 375、600、601、900、1280px、深浅主题，以及总览、创建表单、活动详情、选中并键盘聚焦的节点、节点对话框、CLI 文档，共 60 种状态。城市选择可打开、输入并确认，焦点样本必须实际匹配 `:focus-visible`。

地图第三方请求被阻断，验证本地地图外框与回退页面；底图、远程城市图片和地图服务可用性不在此检查范围。测试会输出四张总览截图及 computed-style JSON，默认目录为系统临时目录下的 `data-coffee-css-smoke`，可用 `CSS_SMOKE_OUTPUT` 指定。

整理级联时应先对基线静态目录采样，再比较当前目录：

```sh
CSS_SMOKE_OUTPUT=/tmp/data-coffee-css-before node scripts/css-smoke.cjs /path/to/baseline/app/web
CSS_SMOKE_BASELINE=/tmp/data-coffee-css-before/css-smoke.json npm run test:css
```

本次在同一 Chrome 环境中对 `9d61605` 与修改后运行了以上矩阵，采集元素布局、颜色、边框与焦点偏移，60 个状态未发现样式差异。截图同时人工核对桌面浅色与手机深色布局。
