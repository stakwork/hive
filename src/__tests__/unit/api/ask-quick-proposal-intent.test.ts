/**
 * Unit tests for the proposal-intent path inside `/api/ask/quick`.
 *
 * We isolate the `runProposalIntent` function by mocking `handleApproval`
 * and `handleRejection` and exercising the route's POST handler with an
 * `approvalIntent` or `rejectionIntent` body. The assertions focus on:
 *   - `X-Approval-Result` present on success, absent on failure
 *   - `X-Approval-Error`  present on failure, absent on success
 *   - `Access-Control-Expose-Headers` covers both when either is set
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/proposals/handleApproval", () => ({
  handleApproval: vi.fn(),
  handleRejection: vi.fn(),
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn().mockResolvedValue("org-1"),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: { findUnique: vi.fn().mockResolvedValue(null) },
    workspace: { findFirst: vi.fn().mockResolvedValue({ id: "ws-1" }) },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateUserBelongsToOrg: vi.fn().mockResolvedValue({ id: "ws-1" }),
}));

// Canvas agent and other heavy dependencies we don't need for this path.
vi.mock("@/lib/ai/runCanvasAgent", () => ({
  runCanvasAgent: vi.fn(),
  extractConceptIdsFromStep: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn().mockReturnValue("ws-channel"),
  PUSHER_EVENTS: { CANVAS_UPDATED: "CANVAS_UPDATED" },
}));

vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn().mockReturnValue("test-key"),
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ai/publicChatBudget", () => ({
  checkPublicChatBudget: vi.fn(),
  deriveAnonymousId: vi.fn(),
  recordTurnTokens: vi.fn(),
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn().mockReturnValue({
    authStatus: "authenticated",
    user: { id: "user-1", login: "testuser" },
  }),
}));

vi.mock("@/lib/ai/concepts", () => ({
  swarmFetch: vi.fn(),
}));

// ── Lazy imports (after mocks) ─────────────────────────────────────────────────

const { handleApproval } = await import("@/lib/proposals/handleApproval");
const mockHandleApproval = handleApproval as Mock;

const { POST } = await import("@/app/api/ask/quick/route");

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/ask/quick", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [MIDDLEWARE_HEADERS.USER_ID]: "user-1",
      [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
      [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
      [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
    },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  messages: [{ role: "user", content: "approve" }],
  workspaceSlug: "test-workspace",
  orgId: "org-1",
  canvasChatMessages: [],
  approvalIntent: {
    proposalId: "prop-abc",
    payload: {},
    currentRef: "",
    viewport: { x: 40, y: 40 },
  },
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runProposalIntent — X-Approval headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets X-Approval-Result and NOT X-Approval-Error on success", async () => {
    const approvalResult = {
      proposalId: "prop-abc",
      kind: "feature" as const,
      createdEntityId: "feat-xyz",
      landedOn: "ws:ws-1",
    };
    mockHandleApproval.mockResolvedValue({
      ok: true,
      result: approvalResult,
      alreadyApproved: false,
    });

    const response = await POST(makeRequest(baseBody));

    expect(response.headers.get("X-Approval-Result")).toBe(
      JSON.stringify(approvalResult),
    );
    expect(response.headers.get("X-Approval-Error")).toBeNull();
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Approval-Result",
    );
  });

  it("sets X-Approval-Error and NOT X-Approval-Result on failure", async () => {
    mockHandleApproval.mockResolvedValue({
      ok: false,
      error: "Approve the blocker proposal first.",
      status: 409,
    });

    const response = await POST(makeRequest(baseBody));

    expect(response.headers.get("X-Approval-Error")).toBe(
      JSON.stringify({
        proposalId: "prop-abc",
        error: "Approve the blocker proposal first.",
      }),
    );
    expect(response.headers.get("X-Approval-Result")).toBeNull();
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Approval-Error",
    );

    // Body should still be a valid SSE stream with the error message
    const text = await response.text();
    expect(text).toContain("I couldn't create that:");
    expect(text).toContain("Approve the blocker proposal first.");
  });

  it("HTTP status is 200 even on approval failure (SSE stream must flush)", async () => {
    mockHandleApproval.mockResolvedValue({
      ok: false,
      error: "Feature title is required.",
      status: 400,
    });

    const response = await POST(makeRequest(baseBody));
    expect(response.status).toBe(200);
  });

  it("does not set either header when there is no approvalIntent", async () => {
    // rejectionIntent path — no DB side-effect header
    const { handleRejection } = await import("@/lib/proposals/handleApproval");
    (handleRejection as Mock).mockReturnValue({ ok: true });

    const body = {
      ...baseBody,
      approvalIntent: undefined,
      rejectionIntent: { proposalId: "prop-abc" },
    };

    const response = await POST(makeRequest(body));
    expect(response.headers.get("X-Approval-Result")).toBeNull();
    expect(response.headers.get("X-Approval-Error")).toBeNull();
  });
});
