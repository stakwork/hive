// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishSkillArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/publish-skill";
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
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const makeArtifact = (overrides: Record<string, unknown> = {}) => ({
  id: "artifact-3",
  type: ArtifactType.PUBLISH_SKILL,
  content: {
    skillName: "My Skill",
    published: false,
    ...overrides,
  },
});

describe("PublishSkillArtifact", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("renders the skill name and Publish button", () => {
    render(<PublishSkillArtifact artifact={makeArtifact() as any} />);
    expect(screen.getByText("Publish Skill")).toBeInTheDocument();
    expect(screen.getByText("My Skill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
  });

  it("renders 'Coming soon' sub-label", () => {
    render(<PublishSkillArtifact artifact={makeArtifact() as any} />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("renders fallback 'Skill' label when skillName is absent", () => {
    render(<PublishSkillArtifact artifact={makeArtifact({ skillName: undefined }) as any} />);
    expect(screen.getByText("Skill")).toBeInTheDocument();
  });

  it("renders in published state when content.published is true", () => {
    render(<PublishSkillArtifact artifact={makeArtifact({ published: true }) as any} />);
    expect(screen.getByRole("button", { name: /published/i })).toBeDisabled();
  });

  it("makes NO external fetch call on publish click", async () => {
    render(<PublishSkillArtifact artifact={makeArtifact() as any} taskId="task-789" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    // Give async effects time to run
    await new Promise((r) => setTimeout(r, 50));

    // Only the task PATCH should be called — no publish API
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/workflow/skills"),
      expect.anything()
    );
  });

  it("patches task as DONE immediately when taskId is provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    render(<PublishSkillArtifact artifact={makeArtifact() as any} taskId="task-789" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-789", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
    });
  });

  it("does NOT patch task when no taskId is provided", async () => {
    render(<PublishSkillArtifact artifact={makeArtifact() as any} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows success toast on publish click", async () => {
    const { toast } = await import("sonner");
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    render(<PublishSkillArtifact artifact={makeArtifact() as any} taskId="task-789" />);
    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Skill marked as published");
    });
  });
});
