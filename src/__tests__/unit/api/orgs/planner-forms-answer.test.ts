/**
 * Unit tests for POST /api/orgs/[githubLogin]/planner-forms/answer
 * (Phase 4 of `docs/plans/canvas-agent-manages-planners.md`).
 */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    feature: { findUnique: vi.fn() },
    sharedConversation: { findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const { sendFeatureChatMessage } = await import(
  "@/services/roadmap/feature-chat"
);
const { POST } = await import(
  "@/app/api/orgs/[githubLogin]/planner-forms/answer/route"
);

const mockFeatureFind = db.feature.findUnique as Mock;
const mockConvFind = db.sharedConversation.findUnique as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockSend = sendFeatureChatMessage as Mock;
const mockTransaction = db.$transaction as Mock;

function makeRequest(
  body: Record<string, unknown>,
  authed = true,
): NextRequest {
  return new NextRequest(
    "http://localhost/api/orgs/test-org/planner-forms/answer",
    {
      method: "POST",
      headers: authed
        ? {
            "Content-Type": "application/json",
            [MIDDLEWARE_HEADERS.USER_ID]: "user-1",
            [MIDDLEWARE_HEADERS.USER_EMAIL]: "t@e.com",
            [MIDDLEWARE_HEADERS.USER_NAME]: "T",
            [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
          }
        : { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ githubLogin: "test-org" }) };
const validBody = {
  featureId: "feat-1",
  plannerMessageId: "pm-1",
  answer: "Q: Provider?\nA: Stripe",
};

describe("POST /api/orgs/[githubLogin]/planner-forms/answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveOrg.mockResolvedValue("org-1");
    mockFeatureFind.mockResolvedValue({
      id: "feat-1",
      parentCanvasConversationId: "conv-1",
      workspace: { sourceControlOrgId: "org-1" },
    });
    mockConvFind.mockResolvedValue({ messages: [] }); // not yet answered
    mockSend.mockResolvedValue({ chatMessage: { id: "x" } });
    // Append transaction: run the callback with a tx stub.
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: vi.fn().mockResolvedValue([{ messages: [] }]),
        sharedConversation: { update: vi.fn().mockResolvedValue({}) },
      }),
    );
  });

  it("401 when unauthenticated", async () => {
    const res = await POST(makeRequest(validBody, false), params);
    expect(res.status).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ featureId: "feat-1" }), params);
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("404 when the org can't be resolved for the caller", async () => {
    mockResolveOrg.mockResolvedValue(null);
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("403 when the feature belongs to another org", async () => {
    mockFeatureFind.mockResolvedValue({
      id: "feat-1",
      parentCanvasConversationId: "conv-1",
      workspace: { sourceControlOrgId: "other-org" },
    });
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("forwards to the planner with replyId and returns answered", async () => {
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "answered" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "feat-1",
        userId: "user-1",
        message: validBody.answer,
        replyId: "pm-1",
      }),
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — already-answered FORM does not re-forward", async () => {
    mockConvFind.mockResolvedValue({
      messages: [
        {
          id: "answered-pm-1",
          source: { kind: "user-answered-planner-form", plannerMessageId: "pm-1" },
        },
      ],
    });
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "already_answered" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("409 when the planner is mid-run", async () => {
    mockSend.mockRejectedValue(
      new Error("A planning workflow is already running for this feature"),
    );
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(409);
  });
});
