/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) => (
    <button onClick={onClick} disabled={disabled} className={className}>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: ({ className }: { className?: string }) => <hr className={className} />,
}));

// Capture the className passed to DialogContent for assertion
let capturedDialogContentClassName = "";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className, style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
    capturedDialogContentClassName = className ?? "";
    return (
      <div data-testid="dialog-content" className={className} style={style}>
        {children}
      </div>
    );
  },
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div data-testid="dialog-footer">{children}</div>,
}));

vi.mock("lucide-react", () => ({
  FileIcon: () => <svg />,
  Loader2: () => <svg />,
  AlertCircle: () => <svg />,
}));

vi.mock("@/lib/harvey-lab-tasks", () => ({
  WORK_TYPE_STYLES: {
    "antitrust": { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  },
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import { TaskDetailsModal } from "@/components/legal/TaskDetailsModal";
import type { HarveyTask } from "@/lib/harvey-lab-tasks";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockTask: HarveyTask = {
  slug: "antitrust/review-merger",
  title: "Review Merger Filing",
  description: "Analyze antitrust implications of the proposed merger.",
  workType: "antitrust",
  taskType: "review",
  difficulty: "hard",
  tags: ["antitrust", "merger"],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TaskDetailsModal", () => {
  beforeEach(() => {
    capturedDialogContentClassName = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error" }));
  });

  it("renders DialogContent with overflow-hidden class", () => {
    render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(capturedDialogContentClassName).toContain("overflow-hidden");
  });

  it("renders DialogContent with max-h-[80vh] and flex flex-col alongside overflow-hidden", () => {
    render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(capturedDialogContentClassName).toContain("h-[80vh]");
    expect(capturedDialogContentClassName).toContain("flex");
    expect(capturedDialogContentClassName).toContain("flex-col");
    expect(capturedDialogContentClassName).toContain("overflow-hidden");
  });

  it("renders the footer when modal is open", () => {
    const { getByTestId } = render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(getByTestId("dialog-footer")).toBeTruthy();
  });

  it("does not render when open is false", () => {
    const { queryByTestId } = render(
      <TaskDetailsModal
        open={false}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(queryByTestId("dialog-content")).toBeNull();
  });
});
