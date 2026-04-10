# Aira MCP Server — Model Context Protocol Integration

Demonstrates how to expose Aira's two-step flow, verification, and trust
layer as MCP tools that any AI agent (Claude Desktop, Cursor, etc.) can
discover and call.

## MCP Tools Exposed

| Tool | Description |
|------|-------------|
| `authorize_action` | Step 1 — authorize an action BEFORE it runs |
| `notarize_action` | Step 2 — notarize the outcome, returns a signed receipt |
| `get_action` | Retrieve full action details and receipt |
| `verify_action` | Verify a receipt's Ed25519 signature |
| `get_receipt` | Retrieve a full receipt by ID |
| `resolve_did` | Resolve a did:web DID to its DID document |
| `verify_credential` | Verify an agent's Verifiable Credential |
| `get_reputation` | Get an agent's reputation score |
| `request_mutual_sign` | Initiate mutual notarization with a counterparty |

## Setup

```bash
npm install aira-sdk @modelcontextprotocol/sdk
export AIRA_API_KEY="aira_live_xxx"    # https://app.airaproof.com/dashboard/api-keys
npx tsx examples/mcp-server/index.ts
```

## Production Usage

Wire the Aira MCP handlers into `@modelcontextprotocol/sdk`:

```typescript
import { Aira } from "aira-sdk";
import { createServer } from "aira-sdk/extras/mcp";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const aira = new Aira({ apiKey: process.env.AIRA_API_KEY! });
const { listTools, callTool } = createServer(aira);

const server = new Server(
  { name: "aira", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, listTools);
server.setRequestHandler(CallToolRequestSchema, callTool);

await server.connect(new StdioServerTransport());
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aira": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server/index.ts"],
      "env": {
        "AIRA_API_KEY": "aira_live_xxx"
      }
    }
  }
}
```

## Output

```
============================================================
  Aira MCP Server — Demo
============================================================

1. Available MCP tools
----------------------------------------
   - notarize_action: Notarize an AI agent action with a cryptographic receipt
     Required: [action_type, details]
   - verify_action: Verify a notarized action's cryptographic receipt
     Required: [action_id]
   - get_receipt: Get the cryptographic receipt for a notarized action
     Required: [receipt_id]

2. Call: notarize_action
----------------------------------------
   Action ID:  act_01J8X7K2M...
   Signature:  ed25519:Mzx0xEB...
   Timestamp:  2026-03-31T12:00:00Z

3. Call: verify_action
----------------------------------------
   Valid:      true
   Key:        aira-signing-key-v1
   Message:    Action receipt exists and signing key is valid...

5. listTools handler response
----------------------------------------
   Registered 3 tools: notarize_action, verify_action, get_receipt

============================================================
  MCP server ready — connect from Claude Desktop or Cursor
============================================================
```

## Links

- [SDK Documentation](https://docs.airaproof.com/docs/getting-started/sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [npm — aira-sdk](https://www.npmjs.com/package/aira-sdk)
