/**
 * Unit tests for the resolveSource helper in src/lib/auth/api-token.ts.
 *
 * Covers:
 *  - session caller (isApiToken=false) → "UI"
 *  - api-token caller (isApiToken=true, no special header) → "API"
 *  - api-token caller with x-actor-source: workflow → "WORKFLOW"
 */
import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { resolveSource } from "@/lib/auth/api-token";

function makeReq(headers?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/workflow/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("resolveSource", () => {
  test("session caller (isApiToken=false) → 'UI'", () => {
    const req = makeReq();
    expect(resolveSource(req, false)).toBe("UI");
  });

  test("api-token caller without x-actor-source → 'API'", () => {
    const req = makeReq({ "x-api-token": "some-token" });
    expect(resolveSource(req, true)).toBe("API");
  });

  test("api-token caller with x-actor-source: workflow → 'WORKFLOW'", () => {
    const req = makeReq({ "x-api-token": "some-token", "x-actor-source": "workflow" });
    expect(resolveSource(req, true)).toBe("WORKFLOW");
  });

  test("api-token caller with x-actor-source: other-value → 'API' (only 'workflow' triggers WORKFLOW)", () => {
    const req = makeReq({ "x-api-token": "some-token", "x-actor-source": "mcp" });
    expect(resolveSource(req, true)).toBe("API");
  });

  test("isApiToken=false overrides any x-actor-source header → always 'UI'", () => {
    const req = makeReq({ "x-actor-source": "workflow" });
    expect(resolveSource(req, false)).toBe("UI");
  });
});
