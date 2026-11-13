/**
 * Unit tests for POST /api/orgs/[githubLogin]/canvas/trace
 *
 * Covers:
 *   - 401 without a session; 400 for a body not in shape
 *   - 404 when the caller is not in the org
 *   - 404 (not 403) when the conversation is private to someone else,
 *     or does not carry the message
 *   - IDOR: a `run` reference the caller is not a member of is rejected
 *     BEFORE any strut or model call is made
 *   - 202/200 happy path: an exact upstream link, stored as an inline
 *     `trace` ref on the source message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const {
  mockValidateUserBelongsToOrg,
  mockSourceControlOrgFindUnique,
  mockSharedConversationFindFirst,
  mockStrutRunFindFirst,
  mockWorkspaceFindUnique,
  mockResolveWorkspaceAccess,
  mockFetchStrutRunEvents,
  mockFetchStrutRunOutput,
  mockAppendTraceArtifact,
} = vi.hoisted(() => ({
  mockValidateUserBelongsToOrg: vi.fn(),
  mockSourceControlOrgFindUnique: vi.fn(),
  mockSharedConversationFindFirst: vi.fn(),
  mockStrutRunFindFirst: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockFetchStrutRunEvents: vi.fn(),
  mockFetchStrutRunOutput: vi.fn(),
  mockAppendTraceArtifact: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({ validateUserBelongsToOrg: mockValidateUserBelongsToOrg }));
vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findUnique: mockSourceControlOrgFindUnique },
    sharedConversation: { findFirst: mockSharedConversationFindFirst },
    strutRun: { findFirst: mockStrutRunFindFirst },
    workspace: { findUnique: mockWorkspaceFindUnique },
  },
}));
vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>("@/lib/auth/workspace-access");
  return { ...actual, resolveWorkspaceAccess: mockResolveWorkspaceAccess };
});
vi.mock("@/services/strut-runs/lab", () => ({
  fetchStrutRunEvents: mockFetchStrutRunEvents,
  fetchStrutRunOutput: mockFetchStrutRunOutput,
}));
vi.mock("@/services/trace/store", () => ({ appendTraceArtifact: mockAppendTraceArtifact }));

const { POST } = await import("@/app/api/orgs/[githubLogin]/canvas/trace/route");

const GITHUB_LOGIN = "acme-org";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN }) };

const MESSAGES = [
  { id: "m-0", role: "user", content: "What does Acme Corp owe?" },
  {
    id: "m-1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call-2",
        toolName: "billing/sum-invoices",
        input: { accountId: "acct_1" },
        output: "Total across all invoices for Acme Corp (acct_1): $12,338.84",
      },
    ],
  },
  { id: "m-2", role: "assistant", content: "Acme Corp owes $12,338.84 across Q1." },
];

const GOOD_BODY = { conversationId: "conv-1", messageId: "m-2", selection: "$12,338.84" };

function request(body: unknown, authed = true): NextRequest {
  const req = new NextRequest(`http://hive.test/api/orgs/${GITHUB_LOGIN}/canvas/trace`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "hive.test" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateUserBelongsToOrg.mockResolvedValue(true);
  mockSourceControlOrgFindUnique.mockResolvedValue({ id: "org-1" });
  mockSharedConversationFindFirst.mockResolvedValue({
    id: "conv-1",
    userId: "user-1",
    isShared: false,
    messages: MESSAGES,
  });
  mockAppendTraceArtifact.mockResolvedValue(undefined);
});

describe("POST /api/orgs/[githubLogin]/canvas/trace", () => {
  it("401 without a session", async () => {
    expect((await POST(request(GOOD_BODY, false), params)).status).toBe(401);
    expect(mockValidateUserBelongsToOrg).not.toHaveBeenCalled();
  });

  it("400 for a body not in shape", async () => {
    for (const body of [
      "not json",
      {},
      { ...GOOD_BODY, conversationId: "" },
      { ...GOOD_BODY, messageId: "" },
      { ...GOOD_BODY, selection: "" },
      { ...GOOD_BODY, selection: "x".repeat(2001) },
      { ...GOOD_BODY, run: { workspace: "acme" } },
    ]) {
      expect((await POST(request(body), params)).status, JSON.stringify(body)).toBe(400);
    }
    expect(mockValidateUserBelongsToOrg).not.toHaveBeenCalled();
  });

  it("404 when the caller is not in the org", async () => {
    mockValidateUserBelongsToOrg.mockResolvedValueOnce(false);
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(404);
    expect(mockSharedConversationFindFirst).not.toHaveBeenCalled();
  });

  it("404 when the conversation is private to someone else", async () => {
    mockSharedConversationFindFirst.mockResolvedValueOnce({
      id: "conv-1",
      userId: "someone-else",
      isShared: false,
      messages: MESSAGES,
    });
    expect((await POST(request(GOOD_BODY), params)).status).toBe(404);
  });

  it("404 when the conversation does not carry the message", async () => {
    const res = await POST(request({ ...GOOD_BODY, messageId: "nope" }), params);
    expect(res.status).toBe(404);
  });

  it("IDOR: a run the caller is not a member of is rejected before any strut or model call", async () => {
    mockResolveWorkspaceAccess.mockResolvedValueOnce({ kind: "not-found" });
    const res = await POST(request({ ...GOOD_BODY, run: { workspace: "other-ws", run: "run-row-1" } }), params);
    expect(res.status).toBe(404);
    expect(mockStrutRunFindFirst).not.toHaveBeenCalled();
    expect(mockFetchStrutRunEvents).not.toHaveBeenCalled();
  });

  it("404 when the run id does not belong to the workspace the caller may read", async () => {
    mockResolveWorkspaceAccess.mockResolvedValueOnce({ kind: "member", workspaceId: "ws-1", slug: "other-ws", userId: "user-1", role: "DEVELOPER" });
    mockStrutRunFindFirst.mockResolvedValueOnce(null);
    const res = await POST(request({ ...GOOD_BODY, run: { workspace: "other-ws", run: "run-row-1" } }), params);
    expect(res.status).toBe(404);
    expect(mockFetchStrutRunEvents).not.toHaveBeenCalled();
  });

  it("200: an exact upstream link, stored as an inline trace ref on the source message", async () => {
    const res = await POST(request(GOOD_BODY), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.kind).toBe("trace");
    expect(body.artifact.id).toBe(`trace:m-2:${body.artifact.id.split(":")[2]}`);
    expect(body.artifact.source.content.selection).toBe("$12,338.84");
    expect(body.artifact.source.content.upstream[0]).toMatchObject({ toolCallId: "call-2", match: "exact" });
    expect(mockAppendTraceArtifact).toHaveBeenCalledWith("conv-1", "m-2", body.artifact);
  });

  it("stores the trace under a shared conversation even when the caller is not its owner", async () => {
    mockSharedConversationFindFirst.mockResolvedValueOnce({
      id: "conv-1",
      userId: "someone-else",
      isShared: true,
      messages: MESSAGES,
    });
    expect((await POST(request(GOOD_BODY), params)).status).toBe(200);
  });
});
