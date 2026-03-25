import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerCoffeeTools } from "./tools/coffee.js";
import { registerMessageTools } from "./tools/message.js";

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "data-coffee",
    version: "0.1.0",
  });

  registerProfileTools(server);
  registerCoffeeTools(server);
  registerMessageTools(server);

  return server;
}
