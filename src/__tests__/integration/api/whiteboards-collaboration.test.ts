import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { PATCH } from "@/app/api/whiteboards/[whiteboardId]/route";
import { db } from "@/lib/db";
import {
  generateUniqueId,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Whiteboard } from "@prisma/client";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// Mock Pusher to verify event broadcasting
const mockPusherTrigger = vi.fn();
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: (...args: any[]) => mockPusherTrigger(...args),
  },
  getWhiteboardChannelName: (whiteboardId: string) => `whiteboard-${whiteboardId}`,
  PUSHER_EVENTS: {
    WHITEBOARD_UPDATE: "whiteboard-update",
  },
}));

// Test data factory for creating complete whiteboard setup
async function createWhiteboardTestSetup() {
  const testData = await db.$transaction(async (tx) => {
    // Create owner user
    const owner = await tx.user.create({
      data: {
        email: `owner-${generateUniqueId()}@example.com`,
        name: "Whiteboard Owner",
      },
    });

    // Create workspace
    const workspace = await tx.workspace.create({
      data: {
        name: "Test Whiteboard Workspace",
        slug: `whiteboard-workspace-${generateUniqueId()}`,
        ownerId: owner.id,
      },
    });

    // Create whiteboard
    const whiteboard = await tx.whiteboard.create({
      data: {
        id: generateUniqueId("wb"),
        name: "Test Whiteboard",
        workspaceId: workspace.id,
        elements: [],
        appState: {},
        files: {},
      },
    });

    return { owner, workspace, whiteboard };
  });

  return testData;
}

// Helper to create PATCH request with middleware headers
function createPatchRequest(url: string, body: any, user?: User) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (user) {
    headers[MIDDLEWARE_HEADERS.USER_ID] = user.id;
    headers[MIDDLEWARE_HEADERS.USER_EMAIL] = user.email;
    headers[MIDDLEWARE_HEADERS.USER_NAME] = user.name || "";
    headers[MIDDLEWARE_HEADERS.AUTH_STATUS] = "authenticated";
    headers[MIDDLEWARE_HEADERS.REQUEST_ID] = generateUniqueId();
  }

  return new Request(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

describe("Whiteboard Collaboration Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testWhiteboard: Whiteboard;

  beforeEach(async () => {
    vi.clearAllMocks();
    const setup = await createWhiteboardTestSetup();
    testUser = setup.owner;
    testWorkspace = setup.workspace;
    testWhiteboard = setup.whiteboard;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("PATCH /api/whiteboards/[whiteboardId]", () => {
    test("should trigger Pusher event with whiteboard ID after successful update", async () => {
      const updatedElements = [
        {
          id: "element-1",
          type: "rectangle",
          x: 100,
          y: 100,
          width: 200,
          height: 150,
        },
      ];

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { elements: updatedElements },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectSuccess(response);

      // Verify Pusher trigger was called
      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `whiteboard-${testWhiteboard.id}`,
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: testWhiteboard.id,
          timestamp: expect.any(String),
        })
      );
    });

    test("Pusher event payload should not exceed 10KB (verify only ID + timestamp sent)", async () => {
      // Create whiteboard with large content
      const largeElements = Array.from({ length: 100 }, (_, i) => ({
        id: `element-${i}`,
        type: "rectangle",
        x: i * 10,
        y: i * 10,
        width: 200,
        height: 150,
        strokeColor: "#000000",
        backgroundColor: "#ffffff",
        fillStyle: "solid",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
      }));

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { elements: largeElements },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectSuccess(response);

      // Verify Pusher was called
      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);

      // Get the payload that was sent to Pusher
      const pusherPayload = mockPusherTrigger.mock.calls[0][2];
      const payloadSize = JSON.stringify(pusherPayload).length;

      // Verify payload is small (only ID + timestamp, not full scene data)
      expect(payloadSize).toBeLessThan(200); // Should be around 100 bytes
      expect(pusherPayload).toEqual({
        whiteboardId: testWhiteboard.id,
        timestamp: expect.any(String),
      });

      // Verify it does NOT contain the full elements array
      expect(pusherPayload.elements).toBeUndefined();
      expect(pusherPayload.appState).toBeUndefined();
      expect(pusherPayload.files).toBeUndefined();
    });

    test("should not trigger Pusher event if update fails", async () => {
      // Use invalid whiteboard ID to cause failure
      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/invalid-id`,
        { elements: [] },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ whiteboardId: "invalid-id" }),
      });

      await expectNotFound(response);

      // Verify Pusher was NOT called
      expect(mockPusherTrigger).not.toHaveBeenCalled();
    });

    test("should not trigger Pusher event if user lacks access", async () => {
      // Create a different user without access
      const unauthorizedUser = await db.user.create({
        data: {
          email: `unauthorized-${generateUniqueId()}@example.com`,
          name: "Unauthorized User",
        },
      });

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { elements: [] },
        unauthorizedUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectForbidden(response);

      // Verify Pusher was NOT called
      expect(mockPusherTrigger).not.toHaveBeenCalled();

      // Cleanup
      await db.user.delete({ where: { id: unauthorizedUser.id } });
    });

    test("should verify workspace access before broadcasting", async () => {
      // Add user as workspace member
      const member = await db.user.create({
        data: {
          email: `member-${generateUniqueId()}@example.com`,
          name: "Workspace Member",
        },
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { name: "Updated by Member" },
        member
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      await expectSuccess(response);

      // Verify Pusher was called (member has access)
      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);

      // Cleanup
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id, userId: member.id },
      });
      await db.user.delete({ where: { id: member.id } });
    });

    test("should handle Pusher trigger errors gracefully without failing request", async () => {
      // Mock Pusher to throw error
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher connection failed"));

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { name: "Updated Name" },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      // Request should still succeed even if Pusher fails
      await expectSuccess(response);

      // Verify Pusher was attempted
      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);

      // Verify whiteboard was actually updated
      const updated = await db.whiteboard.findUnique({
        where: { id: testWhiteboard.id },
      });
      expect(updated?.name).toBe("Updated Name");
    });

    test("should include ISO timestamp in Pusher payload", async () => {
      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { name: "Test" },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);

      const payload = mockPusherTrigger.mock.calls[0][2];
      
      // Verify timestamp is valid ISO string
      expect(payload.timestamp).toBeDefined();
      expect(() => new Date(payload.timestamp)).not.toThrow();
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
    });

    test("should trigger event for name-only updates", async () => {
      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { name: "New Whiteboard Name" },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `whiteboard-${testWhiteboard.id}`,
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: testWhiteboard.id,
        })
      );
    });

    test("should trigger event for elements updates", async () => {
      const newElements = [
        { id: "el-1", type: "text", x: 0, y: 0, text: "Hello" },
      ];

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { elements: newElements },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
    });

    test("should trigger event for appState updates", async () => {
      const newAppState = { viewBackgroundColor: "#ffffff", zoom: 1.5 };

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { appState: newAppState },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
    });

    test("should trigger event for files updates", async () => {
      const newFiles = { "file-1": { mimeType: "image/png", dataURL: "data:..." } };

      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { files: newFiles },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
    });

    test("should use correct channel name format", async () => {
      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { name: "Test" },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      const channelName = mockPusherTrigger.mock.calls[0][0];
      
      // Verify channel follows whiteboard-{id} pattern
      expect(channelName).toBe(`whiteboard-${testWhiteboard.id}`);
      expect(channelName.startsWith("whiteboard-")).toBe(true);
    });

    test("should use correct event name", async () => {
      const request = createPatchRequest(
        `http://localhost:3000/api/whiteboards/${testWhiteboard.id}`,
        { name: "Test" },
        testUser
      );

      await PATCH(request, {
        params: Promise.resolve({ whiteboardId: testWhiteboard.id }),
      });

      const eventName = mockPusherTrigger.mock.calls[0][1];
      
      // Verify event name is correct
      expect(eventName).toBe("whiteboard-update");
    });
  });
});
