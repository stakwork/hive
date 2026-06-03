// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishPromptArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/publish-prompt";
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
  id: "artifact-2",
  type: ArtifactType.PUBLISH_PROMPT,
  content: {
    promptId: 42,
    promptVersionId: 7,
    promptName: "My Prompt",
    published: false,
    ...overrides,
  },
});

describe("PublishPromptArtifact", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders the prompt name and Publish button", () => {
    render(<PublishPromptArtifact artifact={makeArtifact() as any} />);
    expect(screen.getByText("Publish Prompt")).toBeInTheDocument();
    expect(screen.getByText("My Prompt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
  });

  it("renders in published state when content.published is true", () => {
    render(<PublishPromptArtifact artifact={makeArtifact({ published: true }) as any} />);
    expect(screen.getByRole("button", { name: /published/i })).toBeDisabled();
  });

  it("calls the correct prompt publish URL with promptId and promptVersionId", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<PublishPromptArtifact artifact={makeArtifact() as any} taskId="task-456" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workflow/prompts/42/versions/7/publish",
        { method: "POST" }
      );
    });
  });

  it("patches task as DONE on successful publish when taskId is provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<PublishPromptArtifact artifact={makeArtifact() as any} taskId="task-456" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-456", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
    });
  });

  it("does NOT patch task when no taskId is provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<PublishPromptArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error toast and does NOT mark task done on publish failure", async () => {
    const { toast } = await import("sonner");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Prompt not found" }),
    });

    render(<PublishPromptArtifact artifact={makeArtifact() as any} taskId="task-456" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to publish prompt", {
        description: "Prompt not found",
      });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows error toast when promptId or promptVersionId is missing", async () => {
    const { toast } = await import("sonner");
    render(
      <PublishPromptArtifact
        artifact={makeArtifact({ promptId: undefined }) as any}
        taskId="task-456"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Missing prompt ID or version ID");
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
