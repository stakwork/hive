// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/helpers/tasks so we can control allWorkflowArtifactsPublished
// without pulling in server-side Prisma/DB dependencies.
// vi.hoisted ensures the variable is available at the time vi.mock factory runs (hoisted to top).
const { mockAllWorkflowArtifactsPublished } = vi.hoisted(() => ({
  mockAllWorkflowArtifactsPublished: vi.fn(),
}));
vi.mock("@/lib/helpers/tasks", () => ({
  allWorkflowArtifactsPublished: mockAllWorkflowArtifactsPublished,
}));

import { PublishWorkflowArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/publish-workflow";
import { ArtifactType } from "@/lib/chat";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock("lucide-react", () => ({
  Upload: () => <svg data-testid="icon-upload" />,
  CheckCircle2: () => <svg data-testid="icon-check" />,
  Loader2: () => <svg data-testid="icon-loader" />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const makeArtifact = (overrides: Record<string, unknown> = {}) => ({
  id: "artifact-wf-1",
  type: ArtifactType.PUBLISH_WORKFLOW,
  content: {
    workflowId: "wf-123",
    workflowRefId: "ref-123",
    workflowName: "My Workflow",
    published: false,
    ...overrides,
  },
});

const makeMessages = (
  artifacts: Array<{ id: string; type: string; content?: Record<string, unknown> }>,
) => [{ artifacts }];

describe("PublishWorkflowArtifact", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
    // Default: all artifacts are published (helper returns true)
    mockAllWorkflowArtifactsPublished.mockReturnValue(true);
  });

  it("renders the workflow name and Publish button when not published", () => {
    render(<PublishWorkflowArtifact artifact={makeArtifact() as any} />);
    expect(screen.getByText("Publish Workflow")).toBeInTheDocument();
    expect(screen.getByText("My Workflow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
  });

  it("renders in published state when content.published is true", () => {
    render(<PublishWorkflowArtifact artifact={makeArtifact({ published: true }) as any} />);
    expect(screen.getByRole("button", { name: /published/i })).toBeDisabled();
  });

  it("shows success toast after successful publish", async () => {
    const { toast } = await import("sonner");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<PublishWorkflowArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Workflow published successfully");
    });
  });

  it("calls /api/workflow/publish with correct body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<PublishWorkflowArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workflow/publish",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            workflowId: "wf-123",
            workflowRefId: "ref-123",
            artifactId: "artifact-wf-1",
          }),
        }),
      );
    });
  });

  it("PATCHes task as DONE when workflowStatus is COMPLETED and all artifacts published", async () => {
    mockAllWorkflowArtifactsPublished.mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const messages = makeMessages([
      { id: "artifact-wf-1", type: "PUBLISH_WORKFLOW", content: { published: false } },
    ]);

    render(
      <PublishWorkflowArtifact
        artifact={makeArtifact() as any}
        taskId="task-abc"
        taskWorkflowStatus="COMPLETED"
        taskChatMessages={messages}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
    });
  });

  it("does NOT PATCH task when workflowStatus is not COMPLETED", async () => {
    mockAllWorkflowArtifactsPublished.mockReturnValue(true);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const messages = makeMessages([
      { id: "artifact-wf-1", type: "PUBLISH_WORKFLOW", content: { published: false } },
    ]);

    render(
      <PublishWorkflowArtifact
        artifact={makeArtifact() as any}
        taskId="task-abc"
        taskWorkflowStatus="IN_PROGRESS"
        taskChatMessages={messages}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await new Promise((r) => setTimeout(r, 50));

    // Only the publish call, no PATCH
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/"),
      expect.anything(),
    );
  });

  it("does NOT PATCH task when another workflow artifact is still unpublished", async () => {
    // Helper returns false (another artifact is unpublished)
    mockAllWorkflowArtifactsPublished.mockReturnValue(false);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const messages = makeMessages([
      { id: "artifact-wf-1", type: "PUBLISH_WORKFLOW", content: { published: false } },
      { id: "artifact-wf-2", type: "PUBLISH_WORKFLOW", content: { published: false } },
    ]);

    render(
      <PublishWorkflowArtifact
        artifact={makeArtifact() as any}
        taskId="task-abc"
        taskWorkflowStatus="COMPLETED"
        taskChatMessages={messages}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await new Promise((r) => setTimeout(r, 50));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/"),
      expect.anything(),
    );
  });

  it("does not error when taskId and taskChatMessages are omitted", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<PublishWorkflowArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      // Only the publish call, no PATCH
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    // No PATCH call
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/"),
      expect.anything(),
    );
  });

  it("shows error toast when publish API fails", async () => {
    const { toast } = await import("sonner");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });

    render(<PublishWorkflowArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to publish workflow",
        expect.objectContaining({ description: "Server error" }),
      );
    });
  });

  it("shows error toast when workflowId is missing", async () => {
    const { toast } = await import("sonner");
    render(
      <PublishWorkflowArtifact
        artifact={makeArtifact({ workflowId: undefined }) as any}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Missing workflow ID");
    });
  });
});
