import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/tasks/[taskId]/ide-token/route";
import { db } from "@/lib/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { EncryptionService } from "@/lib/encryption";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

vi.mock("@/lib/pods/queries", () => ({
  POD_BASE_DOMAIN: "workspaces.sphinx.chat",
}));

// mockDecryptField is defined inside the factory via vi.hoisted to avoid TDZ
const mockDecryptField = vi.hoisted(() => vi.fn());
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: mockDecryptField,
    })),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const TASK_ID = "task-abc123";
const USER_ID = "user-xyz";
const WORKSPACE_ID = "ws-1";
const POD_ID = "pod-deadbeef";
const PLAIN_PASSWORD = "s3cr3t-password";

function makeRequest(): NextRequest {
  const headers = new Headers();
  headers.set("x-middleware-auth-status", "authenticated");
  headers.set("x-middleware-user-id", USER_ID);
  headers.set("x-middleware-user-email", "test@example.com");
  headers.set("x-middleware-user-name", "Test User");
  return new NextRequest(`http://localhost/api/tasks/${TASK_ID}/ide-token`, {
    method: "POST",
    headers,
  });
}

function makeUnauthenticatedRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${TASK_ID}/ide-token`, {
    method: "POST",
  });
}

const mockTask = {
  id: TASK_ID,
  workspaceId: WORKSPACE_ID,
  agentPassword: JSON.stringify({ data: "encrypted", iv: "iv", tag: "tag" }),
  podId: POD_ID,
};

const mockDb = db as any;
const mockValidateAccess = validateWorkspaceAccessById as Mock;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/tasks/[taskId]/ide-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptField.mockReturnValue(PLAIN_PASSWORD);
    mockValidateAccess.mockResolvedValue({ hasAccess: true });
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = makeUnauthenticatedRequest();
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 404 when task does not exist", async () => {
    mockDb.task.findUnique.mockResolvedValue(null);

    const req = makeRequest();
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 403 for user without workspace access", async () => {
    mockDb.task.findUnique.mockResolvedValue(mockTask);
    mockValidateAccess.mockResolvedValue({ hasAccess: false });

    const req = makeRequest();
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("returns { token: null } when agentPassword is missing", async () => {
    mockDb.task.findUnique.mockResolvedValue({ ...mockTask, agentPassword: null });

    const req = makeRequest();
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });

  test("returns { token: null } when podId is missing", async () => {
    mockDb.task.findUnique.mockResolvedValue({ ...mockTask, podId: null });

    const req = makeRequest();
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeNull();
  });

  test("returns token, expires, and ideUrl when agentPassword and podId are present", async () => {
    mockDb.task.findUnique.mockResolvedValue(mockTask);

    const req = makeRequest();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.token).toBe("string");
    expect(body.token).toMatch(/^[0-9a-f]{64}$/); // 32-byte HMAC-SHA256 hex
    expect(body.expires).toBeGreaterThanOrEqual(nowSeconds + 50);
    expect(body.expires).toBeLessThanOrEqual(nowSeconds + 60);
    expect(body.ideUrl).toBe(`https://${POD_ID}.workspaces.sphinx.chat`);
  });

  test("token is a valid HMAC-SHA256 of 'ide-auth:{expires}' signed with decrypted password", async () => {
    mockDb.task.findUnique.mockResolvedValue(mockTask);

    const req = makeRequest();
    const res = await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });
    const body = await res.json();

    // Recompute expected HMAC to verify correctness
    const crypto = await import("node:crypto");
    const expected = crypto
      .createHmac("sha256", PLAIN_PASSWORD)
      .update(`ide-auth:${body.expires}`)
      .digest("hex");

    expect(body.token).toBe(expected);
  });

  test("decryptField is called with 'agentPassword' field name", async () => {
    mockDb.task.findUnique.mockResolvedValue(mockTask);

    const req = makeRequest();
    await POST(req, { params: Promise.resolve({ taskId: TASK_ID }) });

    expect(mockDecryptField).toHaveBeenCalledWith("agentPassword", mockTask.agentPassword);
  });
});
