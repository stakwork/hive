// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowSummaryDialog } from "@/components/workflow/inspector/WorkflowSummaryDialog";

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown-renderer">{children}</div>
  ),
}));

describe("WorkflowSummaryDialog", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  it("renders spinner and caption in loading state", () => {
    render(<WorkflowSummaryDialog {...baseProps} state="loading" />);
    expect(screen.getByText("Generating summary…")).toBeInTheDocument();
    // Loader icon should be present (animate-spin class)
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders error message and Retry button in error state", () => {
    const onRetry = vi.fn();
    render(
      <WorkflowSummaryDialog
        {...baseProps}
        state="error"
        errorMessage="Something went wrong"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
  });

  it("fires onRetry when Retry button is clicked", () => {
    const onRetry = vi.fn();
    render(
      <WorkflowSummaryDialog
        {...baseProps}
        state="error"
        errorMessage="Error"
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders MarkdownRenderer with content in content state", () => {
    render(
      <WorkflowSummaryDialog
        {...baseProps}
        state="content"
        content="## Summary\n\nSome changes."
      />,
    );
    const renderer = screen.getByTestId("markdown-renderer");
    expect(renderer).toBeInTheDocument();
    expect(renderer).toHaveTextContent("## Summary");
  });

  it("does not render Retry button when onRetry is not provided", () => {
    render(
      <WorkflowSummaryDialog
        {...baseProps}
        state="error"
        errorMessage="Error"
      />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows dialog title", () => {
    render(<WorkflowSummaryDialog {...baseProps} state="loading" />);
    expect(screen.getByText("Workflow Changes Summary")).toBeInTheDocument();
  });

  it("DialogContent uses sm:max-w-[75vw] and not bare max-w-[75vw]", () => {
    render(<WorkflowSummaryDialog {...baseProps} state="loading" />);
    // DialogContent renders in a portal (document.body), not the local container
    const dialogContent = document.querySelector(
      '[class*="sm:max-w-\\[75vw\\]"]',
    );
    expect(dialogContent).toBeInTheDocument();

    // The bare (unscoped) class must not be present
    const bareClass = document.querySelector('[class*="max-w-\\[75vw\\]"]');
    // If found, it should only be because it contains the sm: prefix variant
    if (bareClass) {
      expect(bareClass.className).toMatch(/sm:max-w-\[75vw\]/);
      expect(bareClass.className).not.toMatch(/(?<!\S)max-w-\[75vw\]/);
    }
  });
});
