/**
 * Unit tests for the regression-reopen logic in POST /api/webhook/errors
 *
 * Covers:
 * - RESOLVED issue is reopened to UNRESOLVED on new occurrence
 * - IGNORED issue stays IGNORED on new occurrence
 * - UNRESOLVED issue stays UNRESOLVED on new occurrence
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

const {
  mockValidateApiKey,
  mockFindUnique,
  mockUpdate,
  mockCreate,
  mockEventCreate,
  mockPusherTrigger,
  mockBlobPut,
  mockGetJarvisConfig,
} = vi.hoisted(() => ({
  mockValidateApiKey: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockEventCreate: vi.fn(),
  mockPusherTrigger: vi.fn(),
  mockBlobPut: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
}));

vi.mock("@/lib/api-keys", () => ({ validateApiKey: mockValidateApiKey }));

vi.mock("@/lib/db", () => ({
  db: {
    errorIssue: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      create: mockCreate,
    },
    errorEvent: {
      create: mockEventCreate,
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { ERROR_ISSUE_UPDATED: "error-issue-updated" },
}));

vi.mock("@vercel/blob", () => ({
  put: mockBlobPut,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/lib/utils/error-fingerprint", () => ({
  resolveRepoKey: vi.fn().mockResolvedValue({ repositoryId: "repo-1", repoKey: "repo-1" }),
  computeFingerprint: vi.fn().mockReturnValue("fp-abc123"),
}));

import { POST } from "@/app/api/webhook/errors/route";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const WORKSPACE = { id: "ws-1", slug: "my-ws" };
const API_KEY = { id: "key-1" };
const AUTH_RESULT = { workspace: WORKSPACE, apiKey: API_KEY };

const BASE_ISSUE = {
  id: "issue-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  fingerprint: "fp-abc123",
  repoKey: "repo-1",
  title: "TypeError: oops",
  occurrenceCount: 2,
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
  environment: "production",
  release: null,
  metadata: null,
  kgRefId: null,
};

const BASE_EVENT = {
  id: "event-1",
  issueId: "issue-1",
};

function buildRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/webhook/errors", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    },
    body: JSON.stringify(body),
  });
}

const BODY = {
  exceptionType: "TypeError",
  message: "oops",
  stackTrace: "at fn (file.ts:1:1)",
};

describe("POST /api/webhook/errors — regression-reopen logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiKey.mockResolvedValue(AUTH_RESULT);
    mockBlobPut.mockResolvedValue({ url: "https://blob.vercel-storage.com/test.json" });
    mockPusherTrigger.mockResolvedValue(undefined);
    mockGetJarvisConfig.mockResolvedValue(null); // skip KG
    mockEventCreate.mockResolvedValue(BASE_EVENT);
  });

  it("reopens a RESOLVED issue to UNRESOLVED on new occurrence", async () => {
    mockFindUnique.mockResolvedValue({ id: BASE_ISSUE.id, status: "RESOLVED" });
    mockUpdate.mockResolvedValue({ ...BASE_ISSUE, status: "UNRESOLVED", occurrenceCount: 3 });

    const res = await POST(buildRequest(BODY));
    expect(res.status).toBe(201);

    // Must include status: "UNRESOLVED" in update data
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNRESOLVED" }),
      }),
    );
  });

  it("does NOT change status for an IGNORED issue on new occurrence", async () => {
    mockFindUnique.mockResolvedValue({ id: BASE_ISSUE.id, status: "IGNORED" });
    mockUpdate.mockResolvedValue({ ...BASE_ISSUE, status: "IGNORED", occurrenceCount: 3 });

    const res = await POST(buildRequest(BODY));
    expect(res.status).toBe(201);

    // status should NOT be set in update data
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("status");
  });

  it("does NOT change status for an UNRESOLVED issue on new occurrence", async () => {
    mockFindUnique.mockResolvedValue({ id: BASE_ISSUE.id, status: "UNRESOLVED" });
    mockUpdate.mockResolvedValue({ ...BASE_ISSUE, status: "UNRESOLVED", occurrenceCount: 3 });

    const res = await POST(buildRequest(BODY));
    expect(res.status).toBe(201);

    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("status");
  });

  it("creates a new issue (isNew=true) when no existing issue exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ ...BASE_ISSUE, occurrenceCount: 1 });

    const res = await POST(buildRequest(BODY));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.isNew).toBe(true);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
