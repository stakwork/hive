import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockSlug = "test-workspace";
const mockWorkspace = { id: "ws-1" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: mockSlug, workspace: mockWorkspace }),
}));

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({ processStream: vi.fn() }),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    subscribe: () => ({ bind: vi.fn(), unbind: vi.fn() }),
    unsubscribe: vi.fn(),
  }),
  getWorkspaceChannelName: (s: string) => `workspace-${s}`,
  PUSHER_EVENTS: { FOLLOW_UP_QUESTIONS: "follow-up", PROVENANCE_DATA: "provenance" },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Stub child components so we can call the handlers directly
vi.mock(
  "@/components/dashboard/DashboardChat/ChatInput",
  () => ({ ChatInput: () => <div data-testid="chat-input" /> })
);
vi.mock(
  "@/components/dashboard/DashboardChat/ChatMessage",
  () => ({ ChatMessage: () => null })
);
vi.mock(
  "@/components/dashboard/DashboardChat/ToolCallIndicator",
  () => ({ ToolCallIndicator: () => null })
);
vi.mock(
  "@/components/dashboard/DashboardChat/ProvenanceTree",
  () => ({ ProvenanceTree: () => null })
);
vi.mock(
  "@/components/dashboard/DashboardChat/CreateFeatureModal",
  () => ({
    CreateFeatureModal: ({
      onLaunchPlan,
      onLaunchTask,
    }: {
      onLaunchPlan: (t: string, d: string) => Promise<void>;
      onLaunchTask: (t: string, d: string) => Promise<void>;
    }) => (
      <div>
        <button data-testid="launch-plan" onClick={() => onLaunchPlan("My Feature", "Desc")}>
          Launch Plan
        </button>
        <button data-testid="launch-task" onClick={() => onLaunchTask("My Task", "Desc")}>
          Launch Task
        </button>
      </div>
    ),
  })
);

import { DashboardChat } from "@/components/dashboard/DashboardChat";

// ── helpers ──────────────────────────────────────────────────────────────────
function mockFetch(...responses: Array<{ ok: boolean; body: unknown }>) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const res = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    return Promise.resolve({
      ok: res.ok,
      json: () => Promise.resolve(res.body),
    });
  });
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("DashboardChat — handleLaunchPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reads feature.data.id from POST /api/features response and navigates correctly", async () => {
    const featureId = "feat-123";

    global.fetch = mockFetch(
      { ok: true, body: { success: true, data: { id: featureId, title: "My Feature" } } }, // POST /api/features
      { ok: true, body: {} } // POST /api/features/:id/chat
    );

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-plan"));

    await waitFor(() => {
      // Second fetch should use the correct feature id in the URL
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0]).toBe(`/api/features/${featureId}/chat`);
      expect(mockPush).toHaveBeenCalledWith(`/w/${mockSlug}/plan/${featureId}`);
    });
  });

  test("shows a toast error and does NOT navigate when POST /api/features fails", async () => {
    const { toast } = await import("sonner");

    global.fetch = mockFetch({ ok: false, body: { error: "Server error" } });

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-plan"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to launch Plan Mode", expect.anything());
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});

describe("DashboardChat — handleLaunchTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reads task.data.id from POST /api/tasks response and navigates correctly", async () => {
    const taskId = "task-456";

    global.fetch = mockFetch(
      { ok: true, body: { success: true, data: { id: taskId, title: "My Task" } } }, // POST /api/tasks
      { ok: true, body: {} } // POST /api/chat/message
    );

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-task"));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      // Second call body should contain the correct taskId
      const body = JSON.parse(calls[1][1].body);
      expect(body.taskId).toBe(taskId);
      expect(mockPush).toHaveBeenCalledWith(`/w/${mockSlug}/task/${taskId}`);
    });
  });

  test("shows a toast error and does NOT navigate when POST /api/tasks fails", async () => {
    const { toast } = await import("sonner");

    global.fetch = mockFetch({ ok: false, body: { error: "Server error" } });

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-task"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to launch task", expect.anything());
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
