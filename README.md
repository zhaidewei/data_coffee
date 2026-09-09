# Data Coffee

面向荷兰华人数据同行的低噪声 coffee chat 组织工具。

当前应用位于 [`app/`](app/README.md)，使用 Cloudflare Workers、D1 和原生 Web UI。根目录命令会转发到 `app/`：

```sh
npm run dev
npm run check
npm test
npm run build
```

旧 Vercel MCP 代码入口已于 2026-09-09 从本仓库退休，线上 Vercel 项目已删除。旧数据库未随服务删除。
