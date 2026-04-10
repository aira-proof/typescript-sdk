/**
 * MCP server exposing Aira actions as tools for AI agents.
 *
 * Requires: @modelcontextprotocol/sdk (peer dependency)
 *
 * ---------------------------------------------------------------------------
 * LIFECYCLE & DESIGN NOTES
 * ---------------------------------------------------------------------------
 *
 * MCP is a bidirectional protocol: the host (an AI agent) connects to this
 * server and calls the tools explicitly. There is no "wrap" moment — the
 * agent *chooses* to invoke `authorize_action` before performing the side
 * effect and `notarize_action` after. There is no hidden hook point.
 *
 * That makes this integration AUDIT-ONLY in the sense that we don't own the
 * execution boundary: we can only do what the caller asks us to do. But the
 * exposed tools faithfully implement the two-step flow, so an MCP client
 * that follows the contract gets the full authorization gate.
 *
 * Exposed tools:
 *   - authorize_action   → POST /api/v1/actions
 *   - notarize_action    → POST /api/v1/actions/{id}/notarize
 *   - get_action         → GET  /api/v1/actions/{id}
 *   - verify_action      → GET  /api/v1/verify/action/{id}
 *   - get_receipt        → GET  /api/v1/receipts/{id}
 *   - resolve_did        → POST /api/v1/dids/resolve
 *   - verify_credential  → POST /api/v1/credentials/verify (via agent slug)
 *   - get_reputation     → GET  /api/v1/agents/{slug}/reputation
 *   - request_mutual_sign → POST /api/v1/actions/{id}/mutual-sign/request
 */

import type { Aira } from "../client";
import { AiraError } from "../types";

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
      name: "authorize_action",
      description:
        "Step 1 of the Aira two-step flow. Authorize an action BEFORE it executes. Returns an action_id with status 'authorized' or 'pending_approval'. Throws POLICY_DENIED if a policy blocks the action.",
      inputSchema: {
        type: "object",
        properties: {
          action_type: { type: "string", description: "e.g. email_sent, loan_approved, wire_transfer" },
          details: { type: "string", description: "What the agent is about to do" },
          agent_id: { type: "string", description: "Agent slug" },
          model_id: { type: "string", description: "Model used (optional)" },
          require_approval: { type: "boolean", description: "Force human approval (optional)" },
          approvers: { type: "array", items: { type: "string" }, description: "Approver emails (optional)" },
        },
        required: ["action_type", "details"],
      },
    },
    {
      name: "notarize_action",
      description:
        "Step 2 of the Aira two-step flow. Notarize the outcome of an already-authorized action. Call this AFTER the action has been executed. Returns a cryptographic receipt when outcome is 'completed'.",
      inputSchema: {
        type: "object",
        properties: {
          action_id: { type: "string", description: "action_id returned from authorize_action" },
          outcome: { type: "string", enum: ["completed", "failed"], description: "Did the action succeed?" },
          outcome_details: { type: "string", description: "Optional description of the outcome" },
        },
        required: ["action_id"],
      },
    },
    {
      name: "get_action",
      description: "Retrieve full details of an action including its receipt and authorizations",
      inputSchema: {
        type: "object",
        properties: {
          action_id: { type: "string", description: "Action UUID" },
        },
        required: ["action_id"],
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
    {
      name: "resolve_did",
      description: "Resolve a did:web DID to its DID document",
      inputSchema: {
        type: "object",
        properties: {
          did: { type: "string", description: "The DID to resolve (e.g. did:web:airaproof.com:agents:my-agent)" },
        },
        required: ["did"],
      },
    },
    {
      name: "verify_credential",
      description: "Verify a Verifiable Credential — checks signature, expiry, and revocation status",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent slug whose credential to verify" },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "get_reputation",
      description: "Get the current reputation score and tier for an agent",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Agent slug" },
        },
        required: ["agent_id"],
      },
    },
    {
      name: "request_mutual_sign",
      description: "Initiate a mutual signing request for an action with a counterparty",
      inputSchema: {
        type: "object",
        properties: {
          action_id: { type: "string", description: "Action UUID to co-sign" },
          counterparty_did: { type: "string", description: "DID of the counterparty agent" },
        },
        required: ["action_id", "counterparty_did"],
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
    if (name === "authorize_action") {
      const result = await client.authorize({
        actionType: args.action_type as string,
        details: args.details as string,
        agentId: args.agent_id as string | undefined,
        modelId: args.model_id as string | undefined,
        requireApproval: args.require_approval as boolean | undefined,
        approvers: args.approvers as string[] | undefined,
      });
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "notarize_action") {
      const result = await client.notarize({
        actionId: args.action_id as string,
        outcome: (args.outcome as "completed" | "failed" | undefined) ?? "completed",
        outcomeDetails: args.outcome_details as string | undefined,
      });
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "get_action") {
      const result = await client.getAction(args.action_id as string);
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

    if (name === "resolve_did") {
      const result = await client.resolveDid(args.did as string);
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "verify_credential") {
      const cred = await client.getAgentCredential(args.agent_id as string);
      const result = await client.verifyCredential(cred);
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "get_reputation") {
      const result = await client.getReputation(args.agent_id as string);
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    if (name === "request_mutual_sign") {
      const result = await client.requestMutualSign(
        args.action_id as string,
        args.counterparty_did as string,
      );
      return [{ type: "text", text: JSON.stringify(result) }];
    }

    return [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }];
  } catch (e) {
    if (e instanceof AiraError) {
      return [{ type: "text", text: JSON.stringify({ error: e.message, code: e.code }) }];
    }
    return [{ type: "text", text: JSON.stringify({ error: "Internal error", code: "SDK_ERROR" }) }];
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
