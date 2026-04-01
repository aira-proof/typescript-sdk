/**
 * Aira SDK extras — framework integrations.
 *
 * Each integration is in its own file to avoid importing unnecessary dependencies.
 * Import directly from the subpath:
 *
 *   import { AiraCallbackHandler } from "aira-sdk/extras/langchain";
 *   import { AiraVercelMiddleware } from "aira-sdk/extras/vercel-ai";
 *   import { AiraGuardrail } from "aira-sdk/extras/openai-agents";
 *   import { createServer } from "aira-sdk/extras/mcp";
 *   import { verifySignature, parseEvent } from "aira-sdk/extras/webhooks";
 */

export { AiraCallbackHandler } from "./langchain";
export { AiraVercelMiddleware } from "./vercel-ai";
export { AiraGuardrail } from "./openai-agents";
export { createServer, getTools, handleToolCall } from "./mcp";
export type { MCPTool, MCPTextContent } from "./mcp";
export { verifySignature, parseEvent, WebhookEventType } from "./webhooks";
export type { WebhookEvent, WebhookEventTypeName } from "./webhooks";
export { checkTrust } from "./trust";
export type { TrustPolicy, TrustContext } from "./trust";
