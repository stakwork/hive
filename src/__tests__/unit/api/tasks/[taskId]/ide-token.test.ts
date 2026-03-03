import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/tasks/[taskId]/ide-token/route";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import crypto from "node:crypto";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => {
  const mockInstance = {
    decryptField: vi.fn(),
  };
  return {
    EncryptionService: {
      getInstance: vi.fn(() => mockInstance),
    },
  };
});

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

vi.mock("@/lib/pods/queries", () => ({
  POD_BASE_DOMAIN: "workspaces.sphinx.chat",
}));

// ── Typed handles ─────────────────────────────────────────────────────────────

const mockGetServerSession = getServerSession as Mock;
const mockValidateWorkspaceAccessById = validateWorkspaceAccessById as Mock;
const mockDb = db as any;

function getEncryptionMock() {
  return EncryptionService.getInstance() as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/tasks/task-1/ide-token", { method: "POST" });
}

function makeParams(taskId = "task-1") {
  return { params: Promise.resolve({ taskId }) };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const TASK_ID = "task-1";
const WORKSPACE_ID = "workspace-1";
const POD_ID = "pod-abc123";
const DECRYPTED_PASSWORD = "s3cr3t-password";
const ENCRYPTED_BLOB = JSON.stringify({ iv: "abc", data: "encrypted" });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/tasks/[taskId]/ide-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Auth tests
  describe("authentication", () => {
    test("returns 401 when session is missing", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
    });

    test("returns 401 when session has no user id", async () => {
      mockGetServerSession.mockResolvedValue({ user: {} });

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
    });
  });

  // Task lookup tests
  describe("task lookup", () => {
    test("returns 404 when task is not found", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
      mockDb.task.findUnique.mockResolvedValue(null);

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data).toEqual({ error: "Not found" });
    });
  });

  // Access control tests
  describe("workspace access", () => {
    test("returns 403 when user does not have workspace access", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
      mockDb.task.findUnique.mockResolvedValue({
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        agentPassword: ENCRYPTED_BLOB,
        podId: POD_ID,
      });
      mockValidateWorkspaceAccessById.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data).toEqual({ error: "Forbidden" });
    });
  });

  // Graceful fallback when credentials are absent
  describe("missing pod credentials", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
      mockValidateWorkspaceAccessById.mockResolvedValue({ hasAccess: true });
    });

    test("returns { token: null } when agentPassword is missing", async () => {
      mockDb.task.findUnique.mockResolvedValue({
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        agentPassword: null,
        podId: POD_ID,
      });

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ token: null });
    });

    test("returns { token: null } when podId is missing", async () => {
      mockDb.task.findUnique.mockResolvedValue({
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        agentPassword: ENCRYPTED_BLOB,
        podId: null,
      });

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ token: null });
    });
  });

  // Happy path
  describe("token generation", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
      mockDb.task.findUnique.mockResolvedValue({
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        agentPassword: ENCRYPTED_BLOB,
        podId: POD_ID,
      });
      mockValidateWorkspaceAccessById.mockResolvedValue({ hasAccess: true });
      getEncryptionMock().decryptField.mockReturnValue(DECRYPTED_PASSWORD);
    });

    test("returns token, expires, and ideUrl on success", async () => {
      const before = Math.floor(Date.now() / 1000);

      const res = await POST(makeRequest(), makeParams());
      const data = await res.json();

      const after = Math.floor(Date.now() / 1000);

      expect(res.status).toBe(200);
      expect(typeof data.token).toBe("string");
      expect(data.token).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(data.expires).toBeGreaterThanOrEqual(before + 54);
      expect(data.expires).toBeLessThanOrEqual(after + 56);
      expect(data.ideUrl).toBe(`https://${POD_ID}.workspaces.sphinx.chat`);
    });

    test("token is a valid HMAC-SHA256 of 'ide-auth:{expires}' signed with decrypted password", async () => {
      const res = await POST(makeRequest(), makeParams());
      const { token, expires } = await res.json();

      const expected = crypto
        .createHmac("sha256", DECRYPTED_PASSWORD)
        .update(`ide-auth:${expires}`)
        .digest("hex");

      expect(token).toBe(expected);
    });

    test("decryptField is called with correct field name and parsed JSON", async () => {
      await POST(makeRequest(), makeParams());

      expect(getEncryptionMock().decryptField).toHaveBeenCalledWith(
        "agentPassword",
        JSON.parse(ENCRYPTED_BLOB)
      );
    });

    test("task is queried with deleted:false filter", async () => {
      await POST(makeRequest(), makeParams(TASK_ID));

      expect(mockDb.task.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TASK_ID, deleted: false },
        })
      );
    });
  });
});
