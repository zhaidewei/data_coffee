// CLI reference for terminal users and agents; no requests are executed here.
export function renderCliDocs(root){
root.innerHTML=`<article class="cli-reference"><p class="eyebrow">DOCS / CLI REFERENCE</p><h1>dc-flow</h1><p>给终端用户和 Agent 的 Data Coffee 命令参考。与网页共用 API、身份和权限。</p>
<nav class="cli-toc" aria-label="文档目录"><a href="#cli/setup">开始使用</a> · <a href="#cli/commands">命令</a> · <a href="#cli/auth">认证</a> · <a href="#cli/agents">Agent 调用</a></nav>
<section id="setup"><h2>开始使用</h2><p>需要 Node.js 22+。当前从代码库使用，尚未发布 npm 安装包。在仓库的 app 目录执行：</p><pre><code>node cli/dc-flow.mjs --help
node cli/dc-flow.mjs events list
node cli/dc-flow.mjs events get EVENT_ID</code></pre><p>需要直接使用 <code>dc-flow</code> 命令时，可在 app 目录运行 <code>npm link</code> 注册本地命令。以下示例使用该名称。</p><p>默认连接 <code>http://localhost:8787</code>。通过 <code>--base-url</code> 或 <code>DATA_COFFEE_BASE_URL</code> 指定服务；远端地址必须使用 HTTPS，且不能带路径、查询参数或凭证。</p></section>
<section id="commands"><h2>命令参考</h2><div class="cli-table"><table><thead><tr><th>命令</th><th>用途 / 请求体</th></tr></thead><tbody>
<tr><td><code>events list</code></td><td>列出可见活动，GET /api/events</td></tr><tr><td><code>events get &lt;id&gt;</code></td><td>读取活动详情与当前 version</td></tr><tr><td><code>events create --data @draft.json</code></td><td>创建草稿；title、city、description、rules 与 Web API 一致</td></tr><tr><td><code>events action &lt;id&gt; &lt;action&gt;</code></td><td>提交动作，必须指定 --version 和 --key</td></tr><tr><td><code>auth request --data -</code></td><td>请求邮箱验证码：{email}，会发送邮件</td></tr><tr><td><code>auth verify --data -</code></td><td>验证登录：{email,code,nickname}</td></tr><tr><td><code>auth me</code></td><td>读取当前用户</td></tr><tr><td><code>auth logout</code></td><td>注销当前会话</td></tr></tbody></table></div>
<p>动作名称：<code>edit describe publish select_time join leave apply review withdraw revoke cancel</code>。可执行性与附加字段由 API 根据身份和活动状态校验。</p>
<h3>参数</h3><ul><li><code>--data</code>：JSON 对象、@文件，或 - 从 stdin 读取。</li><li><code>--version</code>：读取到的当前非负整数版本。</li><li><code>--key</code>：一次动作的幂等键，1–100 个字母、数字、冒号、下划线或连字符。</li><li><code>--token-stdin</code>：从 stdin 读取个人访问令牌；不能与 --data - 同用。</li><li><code>--session-stdin</code>：从 stdin 读取会话；不能与 --data - 同用。</li><li><code>--session-only</code>：仅用于 auth verify，输出 {sessionToken}，供安全管道捕获。</li></ul></section>
<section id="auth"><h2>认证与会话</h2><p>推荐在网页登录后创建个人访问令牌，通过 <code>DATA_COFFEE_TOKEN</code> 或 <code>--token-stdin</code> 注入。格式为 dcf_ 加 64 位小写十六进制字符，通过 Authorization: Bearer 发送。两个 token 来源同时提供、或 token 与会话同时提供时拒绝执行。</p><p>Agent 在调用点使用本地 secret CLI 读取令牌，将输出管道接到 <code>dc-flow auth me --token-stdin</code>；读取参数以本机 secret 帮助为准。令牌不能进入命令参数、日志或文件。--token-stdin 与 --data - 不能同用，可通过 @文件提供动作请求体。</p><p>邮箱验证码登录保留作为备用。会话通过 <code>DATA_COFFEE_SESSION</code> 或 <code>--session-stdin</code> 注入；stdin 接受 64 位十六进制 token 或 {sessionToken} JSON。CLI 不保存凭证，也不接受命令行 token。</p><p>Agent 应在调用点通过本地 secret CLI 读取会话并管道注入，避免将会话或验证码写入命令参数、日志和文件。验证登录时，用 stdin 传入验证码请求体，并捕获 --session-only 输出。</p></section>
<section id="agents"><h2>Agent 调用流程</h2><ol><li>先 events get 读取当前状态、版本和候选时段。</li><li>确认所需动作，准备非敏感 JSON 请求体和唯一幂等键。</li><li>提交动作；成功后再次读取活动核对结果。</li></ol><pre><code>dc-flow events get EVENT_ID
# 将 VERSION 替换为刚读取的版本；个人访问令牌由运行环境安全注入
# join.json 根据活动时段包含所需报名偏好
 dc-flow events action EVENT_ID join \\
  --version VERSION --key join-unique-001 --data @join.json
 dc-flow events get EVENT_ID</code></pre>
<p>成功输出 stdout JSON，错误输出 stderr JSON；--help 输出帮助文本。自动化建议直接使用 dc-flow 或 node 脚本，避免 npm 的额外输出。</p><div class="cli-table"><table><thead><tr><th>退出码</th><th>处理方式</th></tr></thead><tbody><tr><td>0</td><td>成功</td></tr><tr><td>1</td><td>网络或 API 错误；写入结果可能未知，先读取核对</td></tr><tr><td>2</td><td>参数错误，修正输入</td></tr><tr><td>3</td><td>认证或权限错误</td></tr><tr><td>4</td><td>版本冲突，重新读取并判断动作</td></tr></tbody></table></div>
<p>CLI 不自动重试。重试同一次 action 必须复用原始 key、version 和请求体；业务意图改变时使用新 key。创建草稿没有幂等支持，超时后先查列表，避免重复创建。</p><p>请求超时 30 秒，拒绝重定向。目前没有分页、删除活动、自动刷新登录。</p></section></article>`;
const section=location.hash.split('/')[1];if(section)root.querySelector('#'+({'setup':'setup','commands':'commands','auth':'auth','agents':'agents'}[section]||'setup'))?.scrollIntoView();
}
