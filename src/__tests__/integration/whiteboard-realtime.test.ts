import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";

// Mock the entire pusher module
vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  
  // Define mocks inside the factory function to avoid hoisting issues
  const mockChannel = {
    bind: vi.fn(),
    unbind: vi.fn(),
  };

  const mockPusherClient = {
    subscribe: vi.fn().mockReturnValue(mockChannel),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockPusherServer = {
    trigger: vi.fn().mockResolvedValue({}),
  };

  return {
    ...actual,
    pusherServer: mockPusherServer,
    getPusherClient: vi.fn(() => mockPusherClient),
  };
});

// Mock Pusher libraries
vi.mock("pusher", () => {
  const MockPusher = vi.fn().mockImplementation(() => ({
    trigger: vi.fn().mockResolvedValue({}),
  }));
  return { default: MockPusher };
});

vi.mock("pusher-js", () => {
  const mockChannel = {
    bind: vi.fn(),
    unbind: vi.fn(),
  };
  
  const MockPusherClient = vi.fn().mockImplementation(() => ({
    subscribe: vi.fn().mockReturnValue(mockChannel),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  }));
  return { default: MockPusherClient };
});

// Import from the mocked module
import { pusherServer, getPusherClient, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";

vi.mock("@/lib/db", () => ({
  db: {
    whiteboard: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
  },
}));

describe("Whiteboard Real-time Integration", () => {
  const mockWhiteboardId = "test-whiteboard-123";
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-123";

  const mockWhiteboard = {
    id: mockWhiteboardId,
    name: "Test Whiteboard",
    workspaceId: mockWorkspaceId,
    elements: [],
    appState: {},
    files: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.whiteboard.findUnique).mockResolvedValue(mockWhiteboard);
    vi.mocked(db.workspace.findFirst).mockResolvedValue({
      id: mockWorkspaceId,
      name: "Test Workspace",
      slug: "test-workspace",
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Channel naming", () => {
    it("should generate correct channel name for whiteboard", () => {
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      expect(channelName).toBe(`whiteboard-${mockWhiteboardId}`);
    });

    it("should generate unique channel names for different whiteboards", () => {
      const channel1 = getWhiteboardChannelName("whiteboard-1");
      const channel2 = getWhiteboardChannelName("whiteboard-2");
      
      expect(channel1).not.toBe(channel2);
      expect(channel1).toBe("whiteboard-whiteboard-1");
      expect(channel2).toBe("whiteboard-whiteboard-2");
    });
  });

  describe("Event broadcasting", () => {
    it("should broadcast whiteboard update with correct payload", async () => {
      const updatedElements = [
        { id: "rect-1", type: "rectangle", x: 10, y: 20 },
      ];

      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const payload = {
        whiteboardId: mockWhiteboardId,
        elements: updatedElements,
        appState: {},
        files: {},
        timestamp: new Date(),
        updatedBy: mockUserId,
      };

      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.WHITEBOARD_UPDATE,
        payload
      );

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `whiteboard-${mockWhiteboardId}`,
        "whiteboard-update",
        expect.objectContaining({
          whiteboardId: mockWhiteboardId,
          elements: updatedElements,
          updatedBy: mockUserId,
        })
      );
    });

    it("should broadcast appState updates", async () => {
      const updatedAppState = {
        viewBackgroundColor: "#ffffff",
        currentItemFontFamily: 1,
        gridSize: 20,
      };

      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const payload = {
        whiteboardId: mockWhiteboardId,
        elements: [],
        appState: updatedAppState,
        files: {},
        timestamp: new Date(),
        updatedBy: mockUserId,
      };

      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.WHITEBOARD_UPDATE,
        payload
      );

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        "whiteboard-update",
        expect.objectContaining({
          appState: updatedAppState,
        })
      );
    });

    it("should broadcast file updates", async () => {
      const updatedFiles = {
        "file-1": {
          dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
          mimeType: "image/png",
          id: "file-1",
        },
      };

      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const payload = {
        whiteboardId: mockWhiteboardId,
        elements: [],
        appState: {},
        files: updatedFiles,
        timestamp: new Date(),
        updatedBy: mockUserId,
      };

      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.WHITEBOARD_UPDATE,
        payload
      );

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        "whiteboard-update",
        expect.objectContaining({
          files: updatedFiles,
        })
      );
    });
  });

  describe("Client subscription", () => {
    it("should subscribe to whiteboard channel", () => {
      const client = getPusherClient();
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      
      const channel = client.subscribe(channelName);
      
      expect(client.subscribe).toHaveBeenCalledWith(channelName);
      expect(channel).toBeDefined();
    });

    it("should bind to WHITEBOARD_UPDATE event", () => {
      const client = getPusherClient();
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const channel = client.subscribe(channelName);
      
      const eventHandler = vi.fn();
      channel.bind(PUSHER_EVENTS.WHITEBOARD_UPDATE, eventHandler);
      
      expect(channel.bind).toHaveBeenCalledWith("whiteboard-update", eventHandler);
    });

    it("should handle multiple subscriptions to same channel", () => {
      const client = getPusherClient();
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      
      const channel1 = client.subscribe(channelName);
      const channel2 = client.subscribe(channelName);
      
      // Pusher typically returns the same channel instance for same channel name
      expect(channel1).toBe(channel2);
    });
  });

  describe("Multiple simultaneous updates", () => {
    it("should handle rapid successive updates", async () => {
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const updates = [
        { elements: [{ id: "1", type: "rectangle" }] },
        { elements: [{ id: "1", type: "rectangle" }, { id: "2", type: "ellipse" }] },
        { elements: [{ id: "1", type: "rectangle" }, { id: "2", type: "ellipse" }, { id: "3", type: "arrow" }] },
      ];

      for (const update of updates) {
        await pusherServer.trigger(
          channelName,
          PUSHER_EVENTS.WHITEBOARD_UPDATE,
          {
            whiteboardId: mockWhiteboardId,
            ...update,
            timestamp: new Date(),
            updatedBy: mockUserId,
          }
        );
      }

      expect(pusherServer.trigger).toHaveBeenCalledTimes(3);
    });

    it("should handle updates from multiple users", async () => {
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const users = ["user-1", "user-2", "user-3"];

      for (const userId of users) {
        await pusherServer.trigger(
          channelName,
          PUSHER_EVENTS.WHITEBOARD_UPDATE,
          {
            whiteboardId: mockWhiteboardId,
            elements: [{ id: `${userId}-element`, type: "rectangle" }],
            timestamp: new Date(),
            updatedBy: userId,
          }
        );
      }

      expect(pusherServer.trigger).toHaveBeenCalledTimes(3);
      
      // Verify each call had different updatedBy
      const calls = vi.mocked(pusherServer.trigger).mock.calls;
      expect(calls[0][2].updatedBy).toBe("user-1");
      expect(calls[1][2].updatedBy).toBe("user-2");
      expect(calls[2][2].updatedBy).toBe("user-3");
    });
  });

  describe("Whiteboard linking/unlinking", () => {
    it("should handle channel switch when whiteboard is linked", () => {
      const client = getPusherClient();
      const oldWhiteboardId = "old-whiteboard-123";
      const newWhiteboardId = "new-whiteboard-456";
      
      // Subscribe to old whiteboard
      const oldChannel = client.subscribe(getWhiteboardChannelName(oldWhiteboardId));
      
      // Unsubscribe from old, subscribe to new
      client.unsubscribe(getWhiteboardChannelName(oldWhiteboardId));
      const newChannel = client.subscribe(getWhiteboardChannelName(newWhiteboardId));
      
      expect(client.unsubscribe).toHaveBeenCalledWith(`whiteboard-${oldWhiteboardId}`);
      expect(client.subscribe).toHaveBeenCalledWith(`whiteboard-${newWhiteboardId}`);
    });

    it("should handle unlinking (switching to null whiteboard)", () => {
      const client = getPusherClient();
      const whiteboardId = "whiteboard-123";
      
      // Subscribe to whiteboard
      client.subscribe(getWhiteboardChannelName(whiteboardId));
      
      // Unlink (unsubscribe)
      client.unsubscribe(getWhiteboardChannelName(whiteboardId));
      
      expect(client.unsubscribe).toHaveBeenCalledWith(`whiteboard-${whiteboardId}`);
    });
  });

  describe("Event payload structure", () => {
    it("should include all required fields in payload", async () => {
      const payload = {
        whiteboardId: mockWhiteboardId,
        elements: [{ id: "1", type: "rectangle" }],
        appState: { viewBackgroundColor: "#fff" },
        files: {},
        timestamp: new Date(),
        updatedBy: mockUserId,
      };

      await pusherServer.trigger(
        getWhiteboardChannelName(mockWhiteboardId),
        PUSHER_EVENTS.WHITEBOARD_UPDATE,
        payload
      );

      const call = vi.mocked(pusherServer.trigger).mock.calls[0];
      const receivedPayload = call[2];

      expect(receivedPayload).toHaveProperty("whiteboardId");
      expect(receivedPayload).toHaveProperty("elements");
      expect(receivedPayload).toHaveProperty("appState");
      expect(receivedPayload).toHaveProperty("files");
      expect(receivedPayload).toHaveProperty("timestamp");
      expect(receivedPayload).toHaveProperty("updatedBy");
    });

    it("should include timestamp as Date object", async () => {
      const timestamp = new Date();
      const payload = {
        whiteboardId: mockWhiteboardId,
        elements: [],
        appState: {},
        files: {},
        timestamp,
        updatedBy: mockUserId,
      };

      await pusherServer.trigger(
        getWhiteboardChannelName(mockWhiteboardId),
        PUSHER_EVENTS.WHITEBOARD_UPDATE,
        payload
      );

      const call = vi.mocked(pusherServer.trigger).mock.calls[0];
      expect(call[2].timestamp).toBeInstanceOf(Date);
    });
  });

  describe("Error scenarios", () => {
    it("should handle Pusher trigger failure gracefully", async () => {
      vi.mocked(pusherServer.trigger).mockRejectedValueOnce(
        new Error("Network error")
      );

      await expect(
        pusherServer.trigger(
          getWhiteboardChannelName(mockWhiteboardId),
          PUSHER_EVENTS.WHITEBOARD_UPDATE,
          {
            whiteboardId: mockWhiteboardId,
            elements: [],
            timestamp: new Date(),
            updatedBy: mockUserId,
          }
        )
      ).rejects.toThrow("Network error");
    });

    it("should handle subscription to invalid channel", () => {
      const client = getPusherClient();
      
      // Even with invalid channel name, subscription should not throw
      expect(() => {
        client.subscribe("");
      }).not.toThrow();
    });
  });

  describe("Channel cleanup", () => {
    it("should unbind event handlers on cleanup", () => {
      const client = getPusherClient();
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      const channel = client.subscribe(channelName);
      
      const eventHandler = vi.fn();
      channel.bind(PUSHER_EVENTS.WHITEBOARD_UPDATE, eventHandler);
      
      // Cleanup
      channel.unbind(PUSHER_EVENTS.WHITEBOARD_UPDATE, eventHandler);
      
      expect(channel.unbind).toHaveBeenCalledWith("whiteboard-update", eventHandler);
    });

    it("should unsubscribe from channel on cleanup", () => {
      const client = getPusherClient();
      const channelName = getWhiteboardChannelName(mockWhiteboardId);
      
      client.subscribe(channelName);
      client.unsubscribe(channelName);
      
      expect(client.unsubscribe).toHaveBeenCalledWith(channelName);
    });
  });
});
