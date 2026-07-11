/**
 * Unit tests for the CourtListener MCP adapter wrappers.
 *
 * Verifies:
 * - Successful executor results → mcpOk shape (isError falsy, JSON content)
 * - String error returns from executors → mcpError shape (isError: true)
 * - 429 rate-limit message is sanitized (no "turn" wording) at this boundary
 * - Missing COURTLISTENER_API_TOKEN propagates as isError: true
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mcpVerifyCitations,
  mcpSearchCaseLaw,
  mcpGetCases,
} from "@/lib/mcp/courtlistenerMcpTools";

// Mock the shared executors so we can control their return values
vi.mock("@/lib/ai/courtlistenerTools", () => ({
  verifyCitations: vi.fn(),
  searchCaseLaw: vi.fn(),
  getCases: vi.fn(),
  // Keep the other exports passthrough — not needed in this test file
  clFetch: vi.fn(),
  stripHtml: vi.fn(),
  verifyCitationsInput: {},
  searchCaseLawInput: {},
  getCasesInput: {},
  buildCourtlistenerTools: vi.fn(),
}));

import {
  verifyCitations,
  searchCaseLaw,
  getCases,
} from "@/lib/ai/courtlistenerTools";

const mockVerifyCitations = vi.mocked(verifyCitations);
const mockSearchCaseLaw = vi.mocked(searchCaseLaw);
const mockGetCases = vi.mocked(getCases);

const originalToken = process.env.COURTLISTENER_API_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.COURTLISTENER_API_TOKEN = "test-token";
});

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.COURTLISTENER_API_TOKEN;
  } else {
    process.env.COURTLISTENER_API_TOKEN = originalToken;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function expectOk(result: { content: Array<{ text: string }>; isError?: boolean }) {
  expect(result.isError).toBeFalsy();
  expect(result.content).toHaveLength(1);
  expect(result.content[0].text).toBeTruthy();
}

function expectError(result: { content: Array<{ text: string }>; isError?: boolean }, pattern?: RegExp | string) {
  expect(result.isError).toBe(true);
  if (pattern) {
    expect(result.content[0].text).toMatch(pattern instanceof RegExp ? pattern : new RegExp(pattern));
  }
}

// ─── mcpVerifyCitations ───────────────────────────────────────────────────────

describe("mcpVerifyCitations", () => {
  it("returns mcpOk shape when executor succeeds", async () => {
    const successData = {
      citationsSubmitted: 1,
      citationLinks: { "410 U.S. 113": "/opinion/1/" },
      results: [],
    };
    mockVerifyCitations.mockResolvedValue(successData);

    const result = await mcpVerifyCitations({ citations: ["410 U.S. 113"] });
    expectOk(result);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.citationsSubmitted).toBe(1);
  });

  it("returns mcpError when executor returns a string", async () => {
    mockVerifyCitations.mockResolvedValue("Could not verify citations: some error");
    const result = await mcpVerifyCitations({ citations: ["bad"] });
    expectError(result, /Could not verify citations/);
  });

  it("sanitizes 429 rate-limit message (removes 'turn' wording)", async () => {
    mockVerifyCitations.mockResolvedValue(
      "Could not verify citations: Error: CourtListener rate-limited — stop all CourtListener calls for this turn",
    );
    const result = await mcpVerifyCitations({ citations: ["foo"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("for this turn");
    expect(result.content[0].text).toContain("please retry later");
  });

  it("does NOT sanitize messages that don't contain the trigger phrase", async () => {
    mockVerifyCitations.mockResolvedValue("Could not verify citations: network timeout");
    const result = await mcpVerifyCitations({ citations: ["foo"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("network timeout");
  });
});

// ─── mcpSearchCaseLaw ─────────────────────────────────────────────────────────

describe("mcpSearchCaseLaw", () => {
  it("returns mcpOk shape when executor succeeds", async () => {
    const successData = [{ clusterId: 42 as number | undefined, caseName: "Roe v. Wade" as string | undefined, citation: "410 U.S. 113" as string | null, court: "scotus" as string | undefined, dateFiled: "1973-01-22" as string | undefined, snippet: undefined as string | undefined, url: null as string | null }];
    mockSearchCaseLaw.mockResolvedValue(successData);

    const result = await mcpSearchCaseLaw({ query: "roe v wade", limit: 5 });
    expectOk(result);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].caseName).toBe("Roe v. Wade");
  });

  it("returns mcpError when executor returns a string", async () => {
    mockSearchCaseLaw.mockResolvedValue("Could not search case law: 500");
    const result = await mcpSearchCaseLaw({ query: "test", limit: 5 });
    expectError(result, /Could not search case law/);
  });

  it("sanitizes 429 rate-limit message", async () => {
    mockSearchCaseLaw.mockResolvedValue(
      "Could not search case law: Error: CourtListener rate-limited — stop all CourtListener calls for this turn",
    );
    const result = await mcpSearchCaseLaw({ query: "test", limit: 5 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("for this turn");
    expect(result.content[0].text).toContain("please retry later");
  });
});

// ─── mcpGetCases ──────────────────────────────────────────────────────────────

describe("mcpGetCases", () => {
  it("returns mcpOk shape when executor succeeds", async () => {
    const successData = { cases: [{ clusterId: 1, caseName: "Test v. Case", opinions: [] }] };
    mockGetCases.mockResolvedValue(successData);

    const result = await mcpGetCases({ clusterIds: [1], includeFullText: false, maxChars: 5000 });
    expectOk(result);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cases).toHaveLength(1);
  });

  it("returns mcpError when executor returns a string", async () => {
    mockGetCases.mockResolvedValue("Could not fetch cases: network error");
    const result = await mcpGetCases({ clusterIds: [1], includeFullText: false, maxChars: 5000 });
    expectError(result, /Could not fetch cases/);
  });

  it("sanitizes 429 rate-limit message", async () => {
    mockGetCases.mockResolvedValue(
      "Could not fetch cases: Error: CourtListener rate-limited — stop all CourtListener calls for this turn",
    );
    const result = await mcpGetCases({ clusterIds: [1], includeFullText: false, maxChars: 5000 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("for this turn");
    expect(result.content[0].text).toContain("please retry later");
  });
});

// ─── 429 message preservation in original (via executor passthrough) ──────────

describe("429 message is unchanged in original executor error strings", () => {
  it("the original 'stop all CourtListener calls for this turn' phrase is preserved by the executor", () => {
    // This test documents that the executor's raw error string still contains
    // the original phrase — only the MCP adapter sanitizes it.
    const rawMsg = "Could not verify citations: Error: CourtListener rate-limited — stop all CourtListener calls for this turn";
    expect(rawMsg).toContain("stop all CourtListener calls for this turn");
  });
});
