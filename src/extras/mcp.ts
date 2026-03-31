/**
 * MCP server exposing Aira actions as tools for AI agents.
 *
 * Requires: @modelcontextprotocol/sdk (peer dependency)
 *
 * Usage:
 *   import { createServer } from "aira-sdk/extras/mcp";
 *   const server = createServer({ apiKey: "aira_live_xxx" });
 */

import type { Aira } from "../client";

/** Tool definition for MCP list_tools response. */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Text content for MCP call_tool response. */
export interface MCPTextContent {
  type: "text";
  text: string;
}

/** MCP tool definitions exposed by the Aira server. */
export function getTools(): MCPTool[] {
  return [
    {
      name: "notarize_action",
      description: "Notarize an AI agent action with a cryptographic receipt",
      inputSchema: {
        type: "object",
        properties: {
          action_type: { type: "string", description: "e.g. email_sent, loan_approved, claim_processed" },
          details: { type: "string", description: "What happened" },
          agent_id: { type: "string", description: "Agent slug" },
          model_id: { type: "string", description: "Model used (optional)" },
        },
        required: ["action_type", "details"],
      },
    },
    {
      name: "verify_action",
      description: "Verify a notarized action's cryptographic receipt",
      inputSchema: {
        type: "object",
        properties: {
          action_id: { type: "string", description: "Action UUID" },
        },
        required: ["action_id"],
      },
    },
    {
      name: "get_receipt",
      description: "Get the cryptographic receipt for a notarized action",
      inputSchema: {
        type: "object",
        properties: {
          receipt_id: { type: "string", description: "Receipt UUID" },
        },
        required: ["receipt_id"],
      },
    },
  ];
}

/** Handle an MCP tool call and return text content. */
export async function handleToolCall(
  client: Aira,
  name: string,
  args: Record<string, unknown>,
): Promise<MCPTextContent[]> {
  try {
    if (name === "notarize_action") {
      const result = await client.notarize({
        actionType: args.action_type as string,
        details: args.details as string,
        agentId: args.agent_id as string | undefined,
        modelId: args.model_id as string | undefined,
      });
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "verify_action") {
      const result = await client.verifyAction(args.action_id as string);
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "get_receipt") {
      const result = await client.getReceipt(args.receipt_id as string);
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    return [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }];
  } catch (e) {
    return [{ type: "text", text: JSON.stringify({ error: String(e) }) }];
  }
}

/**
 * Create an MCP-compatible server handler object.
 *
 * This returns plain objects; wire it into @modelcontextprotocol/sdk's Server:
 *
 *   import { Server } from "@modelcontextprotocol/sdk/server/index.js";
 *   import { createServer } from "aira-sdk/extras/mcp";
 *   const { listTools, callTool } = createServer(airaClient);
 *   server.setRequestHandler(ListToolsRequestSchema, listTools);
 *   server.setRequestHandler(CallToolRequestSchema, callTool);
 */
export function createServer(client: Aira) {
  return {
    listTools: async () => ({ tools: getTools() }),
    callTool: async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const content = await handleToolCall(client, request.params.name, request.params.arguments ?? {});
      return { content };
    },
  };
}
