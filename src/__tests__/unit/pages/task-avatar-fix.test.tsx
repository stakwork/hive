import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import React from "react";

// Make React globally available for components using new JSX transform
if (typeof (global as any).React === 'undefined') {
  (global as any).React = React;
}

import TaskPage from "@/app/w/[slug]/task/[...taskParams]/page";
import * as NextAuthReact from "next-auth/react";

// Mock all dependencies
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    slug: "test-workspace",
    taskParams: ["task-123"],
  }),
  useSearchParams: () => ({
    get: vi.fn(() => null),
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      slug: "test-workspace",
    },
    slug: "test-workspace",
  }),
}));

vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => ({
    canWrite: true,
  }),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(() => ({
    isConnected: true,
    error: null,
  })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    connection: {
      socket_id: "test-socket-id",
    },
  }),
}));

vi.mock("framer-motion", () => {
  const React = require("react");
  return {
    motion: {
      div: ({ children, ...props }: any) => React.createElement("div", props, children),
    },
    AnimatePresence: ({ children }: any) => React.createElement("div", null, children),
  };
});

vi.mock("@/app/w/[slug]/task/[...taskParams]/components", () => {
  const React = require("react");
  return {
    TaskStartInput: vi.fn(() => React.createElement("div", { "data-testid": "task-start-input" })),
    ChatArea: vi.fn((props) => {
      return React.createElement("div", { "data-testid": "chat-area" });
    }),
    AgentChatArea: vi.fn(() => React.createElement("div", { "data-testid": "agent-chat-area" })),
    ArtifactsPanel: vi.fn(() => React.createElement("div", { "data-testid": "artifacts-panel" })),
    CommitModal: vi.fn(() => React.createElement("div", { "data-testid": "commit-modal" })),
    BountyRequestModal: vi.fn(() => React.createElement("div", { "data-testid": "bounty-modal" })),
  };
});

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/TaskStartInput", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/AgentChatArea", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/components/ui/resizable", () => {
  const React = require("react");
  return {
    ResizablePanelGroup: vi.fn(({ children }) => React.createElement("div", null, children)),
    ResizablePanel: vi.fn(({ children }) => React.createElement("div", null, children)),
    ResizableHandle: vi.fn(() => React.createElement("div", null)),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("TaskPage - Avatar Fix for workflow_editor and project_debugger", () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock fetch to return complete message objects with all fields
    mockFetch.mockImplementation(async (url: string, options?: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      
      // Task fetch
      if (urlStr.includes("/api/tasks/")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "task-123",
              title: "Test Task",
              description: "Test description",
              status: "TODO",
            },
          }),
        } as Response;
      }
      
      // Workflow editor chat
      if (urlStr.includes("/api/workflow-editor/chat")) {
        const body = JSON.parse(options?.body || "{}");
        const messageText = body.message || "";
        
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
      
      // Workflow editor endpoint
      if (urlStr.includes("/api/workflow-editor")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            workflow: { webhook: "test-webhook", project_id: 123 },
          }),
        } as Response;
      }
      
      // Default response
      return {
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response;
    });
  });

  describe("workflow_editor mode with session user", () => {
    it("should include createdBy data in optimistic message when session exists", async () => {
      const mockSession = {
        user: {
          id: "user-workflow-1",
          name: "Workflow User",
          email: "workflow@example.com",
          image: "https://example.com/workflow.jpg",
        },
      };

      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/app/w/[slug]/task/[...taskParams]/components");

      render(<TaskPage />);

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
        await props.onSend("Edit this workflow");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Edit this workflow");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.createdBy).toEqual({
        id: "user-workflow-1",
        name: "Workflow User",
        email: "workflow@example.com",
        image: "https://example.com/workflow.jpg",
      });
    });
  });

  describe("workflow_editor mode with null session", () => {
    it("should set createdBy to undefined when session is null", async () => {
      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/app/w/[slug]/task/[...taskParams]/components");

      render(<TaskPage />);

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
        await props.onSend("Edit this workflow");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Edit this workflow");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.createdBy).toBeUndefined();
    });
  });

  describe("project_debugger mode with session user", () => {
    it("should include createdBy data in optimistic message when session exists", async () => {
      const mockSession = {
        user: {
          id: "user-debugger-1",
          name: "Debugger User",
          email: "debugger@example.com",
          image: null,
        },
      };

      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/app/w/[slug]/task/[...taskParams]/components");

      render(<TaskPage />);

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
        await props.onSend("Debug this project");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Debug this project");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.createdBy).toEqual({
        id: "user-debugger-1",
        name: "Debugger User",
        email: "debugger@example.com",
        image: null,
      });
    });
  });

  describe("project_debugger mode with null session", () => {
    it("should set createdBy to undefined when session is null", async () => {
      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: null,
        status: "unauthenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/app/w/[slug]/task/[...taskParams]/components");

      render(<TaskPage />);

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
        await props.onSend("Debug this project");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Debug this project");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.createdBy).toBeUndefined();
    });
  });

  describe("main sendMessage path - no regression", () => {
    it("should still include createdBy in main task chat send path", async () => {
      const mockSession = {
        user: {
          id: "user-main-1",
          name: "Main User",
          email: "main@example.com",
          image: "https://example.com/main.jpg",
        },
      };

      vi.mocked(NextAuthReact.useSession).mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      const { ChatArea } = await import("@/app/w/[slug]/task/[...taskParams]/components");

      render(<TaskPage />);

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
        await props.onSend("Regular chat message");
      });

      await waitFor(() => {
        return vi.mocked(ChatArea).mock.calls.length > initialCallCount;
      }, { timeout: 3000 });

      props = getLatestProps();
      const messages = props.messages || [];
      const optimisticMessage = messages.find((m: any) => m.message === "Regular chat message");
      
      expect(optimisticMessage).toBeDefined();
      expect(optimisticMessage.createdBy).toEqual({
        id: "user-main-1",
        name: "Main User",
        email: "main@example.com",
        image: "https://example.com/main.jpg",
      });
    });
  });
});
