import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PATCH } from "@/app/api/whiteboards/[whiteboardId]/route";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    whiteboard: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWhiteboardChannelName: vi.fn((id: string) => `whiteboard-${id}`),
  PUSHER_EVENTS: {
    WHITEBOARD_UPDATE: "whiteboard-update",
  },
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

import { pusherServer, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

describe("PATCH /api/whiteboards/[whiteboardId]", () => {
  const mockUser = {
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
  };

  const mockWhiteboard = {
    id: "whiteboard-123",
    name: "Test Whiteboard",
    elements: [],
    appState: {},
    files: {},
    workspaceId: "workspace-123",
    workspace: {
      ownerId: "user-123",
      members: [{ userId: "user-123", role: "DEVELOPER" }],
    },
    feature: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMiddlewareContext).mockReturnValue({
      requestId: "req-123",
      authStatus: "authenticated",
      user: mockUser,
    });
    vi.mocked(requireAuth).mockReturnValue(mockUser);
  });

  describe("Pusher event triggering", () => {
    it("should trigger Pusher event when elements are updated", async () => {
      const newElements = [{ type: "rectangle", id: "1" }];
      
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        elements: newElements,
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ elements: newElements }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "whiteboard-whiteboard-123",
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: "whiteboard-123",
          elements: newElements,
          updatedBy: "user-123",
        })
      );
    });

    it("should trigger Pusher event when appState is updated", async () => {
      const newAppState = { viewBackgroundColor: "#ffffff" };
      
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        appState: newAppState,
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ appState: newAppState }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "whiteboard-whiteboard-123",
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: "whiteboard-123",
          appState: newAppState,
          updatedBy: "user-123",
        })
      );
    });

    it("should trigger Pusher event when files are updated", async () => {
      const newFiles = { "file-1": { mimeType: "image/png" } };
      
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        files: newFiles,
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ files: newFiles }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "whiteboard-whiteboard-123",
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: "whiteboard-123",
          files: newFiles,
          updatedBy: "user-123",
        })
      );
    });

    it("should NOT trigger Pusher event when only name is updated", async () => {
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        name: "New Name",
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ name: "New Name" }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    it("should NOT trigger Pusher event when only featureId is updated", async () => {
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        featureId: "feature-123",
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ featureId: "feature-123" }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    it("should not fail the API request if Pusher fails", async () => {
      const newElements = [{ type: "rectangle", id: "1" }];
      
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        elements: newElements,
      } as any);
      
      vi.mocked(pusherServer.trigger).mockRejectedValue(new Error("Pusher error"));

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ elements: newElements }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Payload structure", () => {
    it("should include all required fields in Pusher payload", async () => {
      const newElements = [{ type: "rectangle", id: "1" }];
      const newAppState = { viewBackgroundColor: "#ffffff" };
      
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        elements: newElements,
        appState: newAppState,
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ elements: newElements, appState: newAppState }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "whiteboard-whiteboard-123",
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: "whiteboard-123",
          elements: newElements,
          appState: newAppState,
          timestamp: expect.any(Date),
          updatedBy: "user-123",
        })
      );
    });

    it("should include updatedBy field with user ID", async () => {
      const newElements = [{ type: "rectangle", id: "1" }];
      
      vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard as any);
      vi.mocked(db.whiteboard.update).mockResolvedValue({
        ...mockWhiteboard,
        elements: newElements,
      } as any);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ elements: newElements }),
      });

      await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      const call = vi.mocked(pusherServer.trigger).mock.calls[0];
      expect(call[2]).toHaveProperty("updatedBy", "user-123");
    });
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      const mockResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAuth).mockReturnValue(mockResponse);

      const request = new NextRequest("http://localhost/api/whiteboards/whiteboard-123", {
        method: "PATCH",
        body: JSON.stringify({ elements: [] }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ whiteboardId: "whiteboard-123" }) });

      expect(response.status).toBe(401);
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });
  });
});
