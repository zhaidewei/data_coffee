import type { VercelRequest, VercelResponse } from "@vercel/node";
import { migrate } from "../src/db.js";
import { renderLanding } from "../src/landing.js";

let migrated = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!migrated) {
    await migrate();
    migrated = true;
  }

  const lang = req.query.lang === "en" ? "en" : "zh";
  const html = await renderLanding(lang, "https://data-coffee.vercel.app/api/mcp");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
