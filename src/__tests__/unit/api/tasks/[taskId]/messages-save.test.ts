import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

import { POST } from "@/app/api/tasks/[taskId]/messages/save/route";
import { getServerSession } from "next-auth/next";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";

describe("POST /api/tasks/[taskId]/messages/save", () => {
  const mockUser = { id: "user-123", email: "test@example.com" };
  const mockTaskId = "task-abc";

  const mockTask = {
    workspaceId: "ws-123",
    workspace: {
      ownerId: mockUser.id,
      members: [],
    },
  };

  const mockChatMessage = {
    id: "msg-1",
    taskId: mockTaskId,
    message: "Hello",
    role: "USER",
    artifacts: [],
  };

  function makeRequest(body: object) {
    return new NextRequest("http://localhost/api/tasks/task-abc/messages/save", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.task.findFirst).mockResolvedValue(mockTask as any);
    vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage as any);
  });

  describe("Authentication", () => {
    it("should return 401 when both session and token are null", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await POST(makeRequest({ message: "Hello", role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should authenticate via session cookie", async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
      vi.mocked(getToken).mockResolvedValue(null);

      const res = await POST(makeRequest({ message: "Hello", role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(201);
      expect(vi.mocked(getToken)).not.toHaveBeenCalled();
    });

    it("should authenticate via Bearer token when session is null", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ id: mockUser.id } as any);

      const res = await POST(makeRequest({ message: "Hello", role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(201);
    });

    it("should return 401 when token has no id field", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      vi.mocked(getToken).mockResolvedValue({ sub: "other" } as any);

      const res = await POST(makeRequest({ message: "Hello", role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("Validation", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
    });

    it("should return 400 when message and artifacts are both missing", async () => {
      const res = await POST(makeRequest({ role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 when role is invalid", async () => {
      const res = await POST(makeRequest({ message: "Hello", role: "INVALID" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("Authorization", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any);
    });

    it("should return 404 when task does not exist", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const res = await POST(makeRequest({ message: "Hello", role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(404);
    });

    it("should return 403 when user is not owner or member", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({
        workspaceId: "ws-123",
        workspace: { ownerId: "other-user", members: [] },
      } as any);

      const res = await POST(makeRequest({ message: "Hello", role: "USER" }), {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(res.status).toBe(403);
    });
  });
});
