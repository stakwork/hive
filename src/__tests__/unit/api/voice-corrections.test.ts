import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/voice-corrections/route";
import { getServerSession } from "next-auth";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockSourceControlOrgFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    workspaceMember: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    voiceCorrectionLearning: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    sourceControlOrg: {
      findFirst: (...args: unknown[]) => mockSourceControlOrgFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const mockGetServerSession = getServerSession as Mock;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/voice-corrections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  rawTranscript: "ficks the log in",
  preVoiceText: "",
  finalText: "fix the login",
  surface: "task_chat",
};

describe("POST /api/voice-corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-session-id" } });
    mockCreate.mockResolvedValue({ id: "rec-1" });
    mockFindUnique.mockResolvedValue({ id: "ws-123" }); // workspace exists by default
  });

  test("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest(validBody);
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("returns 400 for an invalid surface enum value", async () => {
    const req = makeRequest({ ...validBody, surface: "invalid_surface" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Invalid surface/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("returns 400 for a missing surface field", async () => {
    const { surface: _surface, ...bodyWithoutSurface } = validBody;
    const req = makeRequest(bodyWithoutSurface);
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("returns 403 when workspaceId is supplied but caller is not a member", async () => {
    mockFindFirst.mockResolvedValue(null); // no membership
    mockFindUnique.mockResolvedValue({ id: "ws-123" });

    const req = makeRequest({ ...validBody, workspaceId: "ws-123" });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-123",
          userId: "user-session-id",
        }),
      }),
    );
  });

  test("userId in created row always equals session.user.id, never body-supplied value", async () => {
    const req = makeRequest(validBody);
    await POST(req);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-session-id" }),
      }),
    );
  });

  test("returns 201 with record id on success", async () => {
    mockCreate.mockResolvedValue({ id: "new-rec-id" });

    const req = makeRequest(validBody);
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("new-rec-id");
  });

  test("allows valid workspaceId when user is a member", async () => {
    mockFindFirst.mockResolvedValue({ id: "member-1" });
    mockFindUnique.mockResolvedValue({ id: "ws-456" });
    mockCreate.mockResolvedValue({ id: "rec-ws" });

    const req = makeRequest({ ...validBody, workspaceId: "ws-456" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: "ws-456" }),
      }),
    );
  });

  test("skips workspace membership check when workspaceId is not provided", async () => {
    const req = makeRequest(validBody);
    await POST(req);

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });

  test.each(["task_chat", "plan_chat", "plan_start", "task_start", "whiteboard", "sidebar"] as const)(
    "accepts valid surface %s",
    async (surface) => {
      const req = makeRequest({ ...validBody, surface });
      const res = await POST(req);

      expect(res.status).toBe(201);
    },
  );

  // --- New tests for empty workspaceId normalization and org resolution ---

  test("workspaceId: '' creates row with workspaceId: null (not a 500)", async () => {
    const req = makeRequest({ ...validBody, workspaceId: "" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockFindFirst).not.toHaveBeenCalled(); // membership check skipped
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null }),
      }),
    );
  });

  test("resolves org defaultWorkspaceId when workspaceId is absent and orgGithubLogin is provided, and caller is a member", async () => {
    mockSourceControlOrgFindFirst.mockResolvedValue({ defaultWorkspaceId: "ws-org-default" });
    mockFindFirst.mockResolvedValue({ id: "member-1" }); // caller is a member of the resolved workspace
    mockFindUnique.mockResolvedValue({ id: "ws-org-default" });
    mockCreate.mockResolvedValue({ id: "rec-org" });

    const req = makeRequest({ ...validBody, orgGithubLogin: "stakwork" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockSourceControlOrgFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubLogin: "stakwork" },
        select: { defaultWorkspaceId: true },
      }),
    );
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-org-default", userId: "user-session-id" }),
      }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: "ws-org-default" }),
      }),
    );
    expect(body.id).toBe("rec-org");
  });

  test("falls back to workspaceId: null when caller is not a member of the org's default workspace", async () => {
    mockSourceControlOrgFindFirst.mockResolvedValue({ defaultWorkspaceId: "ws-org-default" });
    mockFindFirst.mockResolvedValue(null); // caller is NOT a member
    mockCreate.mockResolvedValue({ id: "rec-fallback" });

    const req = makeRequest({ ...validBody, orgGithubLogin: "stakwork" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null }),
      }),
    );
  });

  test("falls back to workspaceId: null when org has no defaultWorkspaceId", async () => {
    mockSourceControlOrgFindFirst.mockResolvedValue({ defaultWorkspaceId: null });

    const req = makeRequest({ ...validBody, orgGithubLogin: "stakwork" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null }),
      }),
    );
  });

  test("falls back to workspaceId: null when org is not found", async () => {
    mockSourceControlOrgFindFirst.mockResolvedValue(null);

    const req = makeRequest({ ...validBody, orgGithubLogin: "unknown-org" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null }),
      }),
    );
  });

  test("falls back to workspaceId: null when resolved workspaceId does not exist in DB", async () => {
    mockFindFirst.mockResolvedValue({ id: "member-1" }); // member check passes
    mockFindUnique.mockResolvedValue(null); // but workspace not found
    mockCreate.mockResolvedValue({ id: "rec-fallback" });

    const req = makeRequest({ ...validBody, workspaceId: "ws-stale" });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: null }),
      }),
    );
  });

  test("returns 200 { skipped: true } instead of 500 when Prisma throws unexpectedly", async () => {
    mockCreate.mockRejectedValue(new Error("DB connection lost"));

    const req = makeRequest(validBody);
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ skipped: true });
  });
});
