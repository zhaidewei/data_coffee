import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createSystemMessage,
  messageSend,
  messageInbox,
  messageRead,
} from "../services/message.js";

// Re-export for backward compatibility (used by coffee tools)
export { createSystemMessage };

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerMessageTools(server: McpServer) {
  server.tool(
    "message_send",
    "Send a direct message to a member (by nickname) or a group message to a coffee session.",
    {
      to: z.string().optional().describe("Recipient nickname (for direct message)"),
      coffee_id: z.string().optional().describe("Coffee ID (for group message)"),
      content: z.string().describe("Message content"),
      reply_to: z.string().optional().describe("Message ID to reply to"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await messageSend(params, userId));
    }
  );

  server.tool(
    "message_inbox",
    "View your inbox — direct messages, coffee group messages, and system notifications.",
    {
      type: z.enum(["direct", "coffee", "system", "all"]).default("all").describe("Filter by message type"),
      unread: z.boolean().default(false).describe("Show only unread messages"),
      coffee_id: z.string().optional().describe("View messages for a specific coffee"),
      limit: z.number().min(1).max(50).default(20).describe("Max results"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await messageInbox(params, userId));
    }
  );

  server.tool(
    "message_read",
    "Mark messages as read.",
    {
      message_id: z.string().optional().describe("Mark a single message as read"),
      coffee_id: z.string().optional().describe("Mark all messages in a coffee as read"),
      all: z.boolean().optional().describe("Mark all unread messages as read"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await messageRead(params, userId));
    }
  );
}
