import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  coffeeCreate,
  coffeeList,
  coffeeJoin,
  coffeeDetail,
  coffeeLeave,
  coffeeUpdate,
  coffeeComplete,
} from "../services/coffee.js";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function registerCoffeeTools(server: McpServer) {
  server.tool(
    "coffee_create",
    "Create a new coffee session. Multi-person by default — set max_size to limit participants.",
    {
      topic: z.string().describe("What do you want to chat about?"),
      description: z.string().optional().describe("More details about this coffee"),
      city: z.string().optional().describe("City for offline meetup (omit for online)"),
      location: z.string().optional().describe("Specific venue or online meeting link"),
      scheduled_at: z.string().optional().describe("Planned date/time (ISO 8601)"),
      max_size: z.number().min(0).default(0).describe("Max participants (0 = unlimited)"),
      tags: z.array(z.string()).optional().describe("Topic tags for discovery"),
    },
    async (params, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await coffeeCreate(params, userId));
    }
  );

  server.tool(
    "coffee_list",
    "Browse open coffee sessions. Filter by city, tags, or just see what's available.",
    {
      city: z.string().optional().describe("Filter by city"),
      tag: z.string().optional().describe("Filter by tag"),
      limit: z.number().min(1).max(50).default(20).describe("Max results"),
    },
    async (params) => jsonResult(await coffeeList(params))
  );

  server.tool(
    "coffee_join",
    "Join an open coffee session",
    {
      coffee_id: z.string().describe("ID of the coffee to join"),
    },
    async ({ coffee_id }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await coffeeJoin({ coffee_id }, userId));
    }
  );

  server.tool(
    "coffee_detail",
    "View details of a coffee session including all participants",
    {
      coffee_id: z.string().describe("ID of the coffee"),
    },
    async ({ coffee_id }) => jsonResult(await coffeeDetail({ coffee_id }))
  );

  server.tool(
    "coffee_leave",
    "Leave a coffee session you joined (creator cannot leave)",
    {
      coffee_id: z.string().describe("ID of the coffee to leave"),
    },
    async ({ coffee_id }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await coffeeLeave({ coffee_id }, userId));
    }
  );

  server.tool(
    "coffee_update",
    "Update a coffee session you created. Only the creator can update.",
    {
      coffee_id: z.string().describe("ID of the coffee to update"),
      topic: z.string().optional().describe("New topic"),
      description: z.string().optional().describe("New description"),
      city: z.string().optional().describe("New city"),
      location: z.string().optional().describe("New location"),
      scheduled_at: z.string().optional().describe("New date/time (ISO 8601)"),
      max_size: z.number().min(0).optional().describe("New max participants (0 = unlimited)"),
      tags: z.array(z.string()).optional().describe("New tags"),
    },
    async ({ coffee_id, ...updates }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await coffeeUpdate({ coffee_id, ...updates }, userId));
    }
  );

  server.tool(
    "coffee_complete",
    "Mark a coffee session as completed (creator only)",
    {
      coffee_id: z.string().describe("ID of the coffee to complete"),
    },
    async ({ coffee_id }, { authInfo }) => {
      const userId = (authInfo?.extra as { userId?: string })?.userId;
      if (!userId) return jsonResult({ error: "Authentication required" });
      return jsonResult(await coffeeComplete({ coffee_id }, userId));
    }
  );
}
