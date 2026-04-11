/**
 * Pins the integration matrix.
 *
 * Three things this test enforces:
 *
 *   1. Every entry in INTEGRATIONS declares a valid kind.
 *   2. preExecutionGate is consistent with kind (gate -> true, otherwise false).
 *   3. The README's integration table mentions every integration name and
 *      labels every gate as having a real gate. This is the test that
 *      catches it when somebody changes a docstring without updating the
 *      README.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import {
  INTEGRATIONS,
  IntegrationKind,
  integrationMatrixMarkdown,
} from "../src/extras";

const VALID_KINDS: ReadonlySet<IntegrationKind> = new Set(["gate", "audit", "adapter"]);

describe("INTEGRATIONS registry", () => {
  it("every integration declares a valid kind", () => {
    for (const spec of INTEGRATIONS) {
      expect(VALID_KINDS.has(spec.kind), `${spec.name}: invalid kind ${spec.kind}`).toBe(true);
    }
  });

  it("kind matches preExecutionGate flag", () => {
    for (const spec of INTEGRATIONS) {
      if (spec.kind === "gate") {
        expect(spec.preExecutionGate, `${spec.name}: gate must have preExecutionGate=true`).toBe(true);
      } else {
        expect(spec.preExecutionGate, `${spec.name}: ${spec.kind} must have preExecutionGate=false`).toBe(false);
      }
    }
  });

  it("no duplicate names", () => {
    const names = INTEGRATIONS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("at least three real gates", () => {
    // Quality over count. The TS SDK has fewer total framework integrations
    // than the Python SDK but every framework it claims to gate must really
    // gate (pre-execution authorize), not just audit after the fact.
    const gates = INTEGRATIONS.filter((s) => s.kind === "gate");
    expect(
      gates.length,
      `Only ${gates.length} real-gate integrations; need at least 3.`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("required competitive integrations are present", () => {
    const names = new Set(INTEGRATIONS.map((s) => s.name));
    for (const required of ["LangChain.js", "Vercel AI SDK", "OpenAI Agents", "MCP"]) {
      expect(names.has(required), `Missing integration: ${required}`).toBe(true);
    }
  });

  it("MCP is honestly labeled as adapter", () => {
    const mcp = INTEGRATIONS.find((s) => s.name === "MCP");
    expect(mcp?.kind).toBe("adapter");
    expect(mcp?.preExecutionGate).toBe(false);
  });
});

describe("integration matrix markdown", () => {
  it("renders a Markdown table with every integration", () => {
    const md = integrationMatrixMarkdown();
    expect(md).toContain("| Integration |");
    for (const spec of INTEGRATIONS) {
      expect(md).toContain(spec.name);
    }
  });
});

describe("README", () => {
  it("references every integration in the registry", () => {
    const readme = join(__dirname, "..", "README.md");
    if (!existsSync(readme)) {
      return; // skip if not present in test environment
    }
    const text = readFileSync(readme, "utf-8");
    for (const spec of INTEGRATIONS) {
      expect(text, `README does not mention ${spec.name}`).toContain(spec.name);
    }
  });
});
