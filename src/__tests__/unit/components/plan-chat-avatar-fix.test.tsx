import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Make React globally available for components using new JSX transform
if (typeof (global as any).React === 'undefined') {
  (global as any).React = React;
}

import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import * as NextAuthReact from "next-auth/react";

// Mock dependencies
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: vi.fn(() => null),
  }),
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/usePlanPresence", () => ({
  usePlanPresence: () => ({ collaborators: [] }),
}));

vi.mock("@/hooks/useDetailResource", () => ({
  useDetailResource: () => ({
    data: null,
    setData: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    connection: {
      socket_id: "test-socket-id",
    },
  }),
}));

vi.mock("@/components/chat", () => {
  const React = require("react");
  return {
    ChatArea: vi.fn(() => React.createElement("div", { "data-testid": "chat-area" })),
    ArtifactsPanel: vi.fn(() => React.createElement("div", { "data-testid": "artifacts-panel" })),
  };
});

vi.mock("@/components/ui/resizable", () => {
  const React = require("react");
  return {
    ResizablePanelGroup: vi.fn(({ children }) => React.createElement("div", null, children)),
    ResizablePanel: vi.fn(({ children }) => React.createElement("div", null, children)),
    ResizableHandle: vi.fn(() => React.createElement("div", null)),
  };
});

describe("PlanChatView - Avatar Fix", () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    // Don't clear all mocks - it resets our ChatArea mock implementation
    mockFetch.mockClear();
    // Mock fetch to return a complete message object that includes all fields
    mockFetch.mockImplementation(async (url: string, options?: any) => {
      if (url.includes('/chat')) {
        const body = JSON.parse(options?.body || "{}");
        const messageText = body.message || "";
        const replyId = body.replyId || undefined;
        
        // Get the current session to determine createdBy
        const sessionData = vi.mocked(NextAuthReact.useSession).mock.results[
          vi.mocked(NextAuthReact.useSession).mock.results.length - 1
        ]?.value?.data;
        
        return {
          ok: true,
          json: async () => ({
            message: {
              id: "real-id",
              message: messageText,
              role: "USER",
              status: "SENT",
              replyId,
              createdBy: sessionData?.user
                ? {
                    id: sessionData.user.id,
                    name: sessionData.user.name || null,
                    email: sessionData.user.email || null,
                    image: sessionData.user.image || null,
                  }
                : undefined,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
        } as Response;
      }
      
      // Default for other endpoints (like loading messages)
      return {
        ok: true,
        json: async () => ({ data: [], success: true }),
      } as Response;
    });
  });

  describe("sendMessage with session user", () => {
    it("should include createdBy data in optimistic message when session exists", async () => {
      const mockSession = {
        user: {
          id: "user-123",
          name: "Test User",
          email: "test@example.com",
          image: "https://example.com/avatar.jpg",
        },
      };

      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/components/chat");

      render(
        <PlanChatView
          featureId="feature-1"
          workspaceSlug="test-workspace"
          workspaceId="workspace-1"
        />
      );

      // Wait for initial render and loadMessages to complete
      await waitFor(() => {
        expect(ChatArea).toHaveBeenCalled();
      });

      const initialCallCount = vi.mocked(ChatArea).mock.calls.length;

      // Get the onSend callback from the most recent call
      const getLatestProps = () => {
        const calls = vi.mocked(ChatArea).mock.calls;
        return calls[calls.length - 1]?.[0];
      };

      let props = getLatestProps();
      expect(props?.onSend).toBeDefined();

      // Trigger send - this will call setMessages internally
      await act(async () => {
        await props.onSend("Test message");
      });

      // Wait for ChatArea to be called again (re-render with new state)
      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      // Now check the optimistic message in the latest render
      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Test message");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.message).toBe("Test message");
      expect(optimisticMessage.createdBy).toEqual({
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        image: "https://example.com/avatar.jpg",
      });
    });
  });

  describe("sendMessage with null session", () => {
    it("should set createdBy to undefined when session is null", async () => {
      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/components/chat");

      render(
        <PlanChatView
          featureId="feature-1"
          workspaceSlug="test-workspace"
          workspaceId="workspace-1"
        />
      );

      await waitFor(() => {
        expect(ChatArea).toHaveBeenCalled();
      });

      const initialCallCount = vi.mocked(ChatArea).mock.calls.length;

      const getLatestProps = () => {
        const calls = vi.mocked(ChatArea).mock.calls;
        return calls[calls.length - 1]?.[0];
      };

      let props = getLatestProps();
      expect(props?.onSend).toBeDefined();

      await act(async () => {
        await props.onSend("Test message");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Test message");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.message).toBe("Test message");
      expect(optimisticMessage.createdBy).toBeUndefined();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("handleArtifactAction with session user", () => {
    it("should include createdBy data in optimistic message when session exists", async () => {
      const mockSession = {
        user: {
          id: "user-456",
          name: "Another User",
          email: "another@example.com",
          image: null,
        },
      };

      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/components/chat");

      render(
        <PlanChatView
          featureId="feature-1"
          workspaceSlug="test-workspace"
          workspaceId="workspace-1"
        />
      );

      await waitFor(() => {
        expect(ChatArea).toHaveBeenCalled();
      });

      const initialCallCount = vi.mocked(ChatArea).mock.calls.length;

      const getLatestProps = () => {
        const calls = vi.mocked(ChatArea).mock.calls;
        return calls[calls.length - 1]?.[0];
      };

      let props = getLatestProps();
      expect(props?.onArtifactAction).toBeDefined();

      await act(async () => {
        await props.onArtifactAction("message-123", { optionResponse: "Yes, continue" });
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Yes, continue");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.message).toBe("Yes, continue");
      expect(optimisticMessage.createdBy).toEqual({
        id: "user-456",
        name: "Another User",
        email: "another@example.com",
        image: null,
      });
      expect(optimisticMessage.replyId).toBe("message-123");
    });
  });

  describe("handleArtifactAction with null session", () => {
    it("should set createdBy to undefined when session is null", async () => {
      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/components/chat");

      render(
        <PlanChatView
          featureId="feature-1"
          workspaceSlug="test-workspace"
          workspaceId="workspace-1"
        />
      );

      await waitFor(() => {
        expect(ChatArea).toHaveBeenCalled();
      });

      const initialCallCount = vi.mocked(ChatArea).mock.calls.length;

      const getLatestProps = () => {
        const calls = vi.mocked(ChatArea).mock.calls;
        return calls[calls.length - 1]?.[0];
      };

      let props = getLatestProps();
      expect(props?.onArtifactAction).toBeDefined();

      await act(async () => {
        await props.onArtifactAction("message-123", { optionResponse: "Yes, continue" });
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Yes, continue");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.message).toBe("Yes, continue");
      expect(optimisticMessage.createdBy).toBeUndefined();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("user with no profile image", () => {
    it("should handle null image gracefully in sendMessage", async () => {
      const mockSession = {
        user: {
          id: "user-789",
          name: "No Image User",
          email: "noimage@example.com",
          image: null,
        },
      };

      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/components/chat");

      render(
        <PlanChatView
          featureId="feature-1"
          workspaceSlug="test-workspace"
          workspaceId="workspace-1"
        />
      );

      await waitFor(() => {
        expect(ChatArea).toHaveBeenCalled();
      });

      const initialCallCount = vi.mocked(ChatArea).mock.calls.length;

      const getLatestProps = () => {
        const calls = vi.mocked(ChatArea).mock.calls;
        return calls[calls.length - 1]?.[0];
      };

      let props = getLatestProps();
      expect(props?.onSend).toBeDefined();

      await act(async () => {
        await props.onSend("Test message");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Test message");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.message).toBe("Test message");
      expect(optimisticMessage.createdBy.image).toBeNull();
      expect(optimisticMessage.createdBy.id).toBe("user-789");
    });
  });
});
