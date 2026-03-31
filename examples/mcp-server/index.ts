/**
 * Aira MCP Server — Expose notarization as Model Context Protocol tools
 *
 * Starts an MCP server (over stdio) that AI agents like Claude Desktop
 * or Cursor can connect to. Provides three tools:
 *   - notarize_action  — create a cryptographic receipt for any action
 *   - verify_action    — verify a receipt's Ed25519 signature
 *   - get_receipt      — retrieve a full receipt by ID
 *
 * Requires: @modelcontextprotocol/sdk
 *
 * Usage:
 *   npm install aira-sdk @modelcontextprotocol/sdk
 *   export AIRA_API_KEY="aira_live_xxx"
 *   npx tsx examples/mcp-server/index.ts
 */

import { Aira } from "aira-sdk";
import { createServer, getTools, handleToolCall } from "aira-sdk/extras/mcp";

// ── Setup ────────────────────────────────────────────────────────────
const AIRA_API_KEY = process.env.AIRA_API_KEY;
if (!AIRA_API_KEY) {
  console.error("Error: Set AIRA_API_KEY environment variable");
  console.error("  Get your key at https://app.airaproof.com/dashboard/api-keys");
  process.exit(1);
}

const aira = new Aira({ apiKey: AIRA_API_KEY });

// createServer() returns { listTools, callTool } handlers you wire into
// @modelcontextprotocol/sdk's Server class.
const mcpHandlers = createServer(aira);

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Aira MCP Server — Demo");
  console.log("=".repeat(60) + "\n");

  // ── 1. Show available tools ──────────────────────────────────────
  console.log("1. Available MCP tools");
  console.log("-".repeat(40));
  const tools = getTools();
  for (const tool of tools) {
    const required = (tool.inputSchema as Record<string, unknown>).required as string[];
    console.log(`   - ${tool.name}: ${tool.description}`);
    console.log(`     Required: [${required.join(", ")}]`);
  }

  // ── 2. Simulate notarize_action call ─────────────────────────────
  console.log("\n2. Call: notarize_action");
  console.log("-".repeat(40));
  const notarizeResult = await handleToolCall(aira, "notarize_action", {
    action_type: "document_reviewed",
    details: "Reviewed contract #C-2024-0891 for compliance risks",
    agent_id: "mcp-compliance-agent",
    model_id: "claude-sonnet-4-6",
  });
  const receipt = JSON.parse(notarizeResult[0].text);
  console.log(`   Action ID:  ${receipt.action_id?.slice(0, 24)}...`);
  console.log(`   Signature:  ${receipt.signature?.slice(0, 30)}...`);
  console.log(`   Timestamp:  ${receipt.timestamp}`);

  // ── 3. Simulate verify_action call ───────────────────────────────
  console.log("\n3. Call: verify_action");
  console.log("-".repeat(40));
  const verifyResult = await handleToolCall(aira, "verify_action", {
    action_id: receipt.action_id,
  });
  const verification = JSON.parse(verifyResult[0].text);
  console.log(`   Valid:      ${verification.valid}`);
  console.log(`   Key:        ${verification.public_key_id}`);
  console.log(`   Message:    ${verification.message?.slice(0, 50)}...`);

  // ── 4. Wire into @modelcontextprotocol/sdk ───────────────────────
  console.log("\n4. Integration with @modelcontextprotocol/sdk");
  console.log("-".repeat(40));
  console.log("   In production, wire handlers into the MCP Server:");
  console.log("");
  console.log('   import { Server } from "@modelcontextprotocol/sdk/server/index.js";');
  console.log('   import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";');
  console.log('   import { ListToolsRequestSchema, CallToolRequestSchema }');
  console.log('     from "@modelcontextprotocol/sdk/types.js";');
  console.log("");
  console.log("   const server = new Server({ name: 'aira', version: '1.0.0' }, {");
  console.log("     capabilities: { tools: {} },");
  console.log("   });");
  console.log("   server.setRequestHandler(ListToolsRequestSchema, mcpHandlers.listTools);");
  console.log("   server.setRequestHandler(CallToolRequestSchema, mcpHandlers.callTool);");
  console.log("   await server.connect(new StdioServerTransport());");

  // ── 5. Demonstrate listTools handler ─────────────────────────────
  console.log("\n5. listTools handler response");
  console.log("-".repeat(40));
  const listResult = await mcpHandlers.listTools();
  console.log(`   Registered ${listResult.tools.length} tools: ${listResult.tools.map((t) => t.name).join(", ")}`);

  console.log("\n" + "=".repeat(60));
  console.log("  MCP server ready — connect from Claude Desktop or Cursor");
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
