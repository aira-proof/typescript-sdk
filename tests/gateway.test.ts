import { describe, it, expect } from "vitest";
import { gatewayOpenAIConfig, gatewayAnthropicConfig } from "../src/gateway";

describe("gatewayOpenAIConfig", () => {
  it("returns correct baseURL and headers with default gateway", () => {
    const config = gatewayOpenAIConfig({ airaApiKey: "aira_live_test123" });
    expect(config.baseURL).toBe("https://api.airaproof.com/gateway/openai/v1");
    expect(config.defaultHeaders).toEqual({
      "X-Aira-Api-Key": "aira_live_test123",
    });
  });

  it("uses custom gatewayUrl", () => {
    const config = gatewayOpenAIConfig({
      airaApiKey: "aira_live_abc",
      gatewayUrl: "https://custom.example.com",
    });
    expect(config.baseURL).toBe(
      "https://custom.example.com/gateway/openai/v1",
    );
    expect(config.defaultHeaders["X-Aira-Api-Key"]).toBe("aira_live_abc");
  });

  it("strips trailing slash from gatewayUrl", () => {
    const config = gatewayOpenAIConfig({
      airaApiKey: "key",
      gatewayUrl: "https://example.com/",
    });
    expect(config.baseURL).toBe("https://example.com/gateway/openai/v1");
  });
});

describe("gatewayAnthropicConfig", () => {
  it("returns correct baseURL and headers with default gateway", () => {
    const config = gatewayAnthropicConfig({ airaApiKey: "aira_live_test456" });
    expect(config.baseURL).toBe(
      "https://api.airaproof.com/gateway/anthropic/v1",
    );
    expect(config.defaultHeaders).toEqual({
      "X-Aira-Api-Key": "aira_live_test456",
    });
  });

  it("uses custom gatewayUrl", () => {
    const config = gatewayAnthropicConfig({
      airaApiKey: "aira_live_xyz",
      gatewayUrl: "https://custom.example.com",
    });
    expect(config.baseURL).toBe(
      "https://custom.example.com/gateway/anthropic/v1",
    );
    expect(config.defaultHeaders["X-Aira-Api-Key"]).toBe("aira_live_xyz");
  });

  it("strips trailing slash from gatewayUrl", () => {
    const config = gatewayAnthropicConfig({
      airaApiKey: "key",
      gatewayUrl: "https://example.com/",
    });
    expect(config.baseURL).toBe("https://example.com/gateway/anthropic/v1");
  });
});
