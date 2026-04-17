/**
 * Helpers for routing LLM SDK calls through Aira Gateway.
 *
 * Usage (OpenAI):
 *   import OpenAI from "openai";
 *   import { gatewayOpenAIConfig } from "aira-sdk/gateway";
 *   const client = new OpenAI({
 *     ...gatewayOpenAIConfig({ airaApiKey: "aira_live_..." }),
 *     apiKey: "sk-...",
 *   });
 *
 * Usage (Anthropic):
 *   import Anthropic from "@anthropic-ai/sdk";
 *   import { gatewayAnthropicConfig } from "aira-sdk/gateway";
 *   const client = new Anthropic({
 *     ...gatewayAnthropicConfig({ airaApiKey: "aira_live_..." }),
 *     apiKey: "sk-ant-...",
 *   });
 */

const DEFAULT_GATEWAY_URL = "https://api.airaproof.com";

export function gatewayOpenAIConfig(opts: {
  airaApiKey: string;
  gatewayUrl?: string;
}): { baseURL: string; defaultHeaders: Record<string, string> } {
  const base = (opts.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
  return {
    baseURL: `${base}/gateway/openai/v1`,
    defaultHeaders: { "X-Aira-Api-Key": opts.airaApiKey },
  };
}

export function gatewayAnthropicConfig(opts: {
  airaApiKey: string;
  gatewayUrl?: string;
}): { baseURL: string; defaultHeaders: Record<string, string> } {
  const base = (opts.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
  return {
    baseURL: `${base}/gateway/anthropic/v1`,
    defaultHeaders: { "X-Aira-Api-Key": opts.airaApiKey },
  };
}
