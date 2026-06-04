// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishScriptArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/publish-script";
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
  id: "artifact-1",
  type: ArtifactType.PUBLISH_SCRIPT,
  content: {
    scriptId: 1,
    scriptVersionId: 1,
    scriptName: "My Script",
    published: false,
    ...overrides,
  },
});

describe("PublishScriptArtifact", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders the script name and Publish button", () => {
    render(<PublishScriptArtifact artifact={makeArtifact() as any} />);
    expect(screen.getByText("Publish Script")).toBeInTheDocument();
    expect(screen.getByText("My Script")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
  });

  it("renders in published state when content.published is true", () => {
    render(<PublishScriptArtifact artifact={makeArtifact({ published: true }) as any} />);
    expect(screen.getByRole("button", { name: /published/i })).toBeDisabled();
  });

  it("calls the correct publish URL with scriptVersionId on click", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // publish
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // task PATCH

    render(<PublishScriptArtifact artifact={makeArtifact() as any} taskId="task-123" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workflow/scripts/1/versions/1/publish",
        { method: "POST" }
      );
    });
  });

  it("patches task as DONE on successful publish when taskId is provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<PublishScriptArtifact artifact={makeArtifact() as any} taskId="task-123" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-123", {
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

    render(<PublishScriptArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/api/tasks/"),
        expect.anything()
      );
    });
  });

  it("shows error toast and does NOT mark task done on publish failure", async () => {
    const { toast } = await import("sonner");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });

    render(<PublishScriptArtifact artifact={makeArtifact() as any} taskId="task-123" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to publish script", {
        description: "Server error",
      });
    });

    // Task should NOT be patched
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows error toast when scriptVersionId is missing", async () => {
    const { toast } = await import("sonner");
    render(
      <PublishScriptArtifact
        artifact={makeArtifact({ scriptVersionId: undefined }) as any}
        taskId="task-123"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Missing script ID or version ID");
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
