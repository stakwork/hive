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

vi.mock("@/lib/db", () => ({
  db: {
    workspaceMember: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    voiceCorrectionLearning: {
      create: (...args: unknown[]) => mockCreate(...args),
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

    const req = makeRequest({ ...validBody, workspaceId: "ws-123" });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws-123",
          userId: "user-session-id",
          leftAt: null,
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
});
