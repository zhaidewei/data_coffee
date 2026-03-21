import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerCoffeeTools } from "./tools/coffee.js";
import { migrate } from "./db.js";

let migrated = false;

export async function createServer(): Promise<McpServer> {
  if (!migrated) {
    await migrate();
    migrated = true;
  }

  const server = new McpServer({
    name: "data-coffee",
    version: "0.1.0",
  });

  registerProfileTools(server);
  registerCoffeeTools(server);

  return server;
}
