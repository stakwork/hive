// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PullRequestArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/pull-request";
import { Artifact, ArtifactType } from "@/lib/chat";

// Mock shadcn Button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, className, style, ...props }: any) => {
    if (asChild) {
      // When asChild, render the single child directly, passing through props
      const child = React.Children.only(children) as React.ReactElement;
      return React.cloneElement(child, { className, style, ...child.props });
    }
    return (
      <button className={className} style={style} {...props}>
        {children}
      </button>
    );
  },
}));

// Mock shadcn Card
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  GitPullRequest: () => <svg data-testid="icon-pull-request" />,
  GitMerge: () => <svg data-testid="icon-merge" />,
  GitPullRequestClosed: () => <svg data-testid="icon-closed" />,
  ExternalLink: () => <svg data-testid="icon-external-link" />,
  AlertTriangle: () => <svg data-testid="icon-alert" />,
  XCircle: () => <svg data-testid="icon-x-circle" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  CheckCircle: () => <svg data-testid="icon-check" />,
}));

const makeArtifact = (status: string): Artifact => ({
  id: "artifact-1",
  type: ArtifactType.PULL_REQUEST,
  content: {
    url: "https://github.com/org/repo/pull/42",
    repo: "org/repo",
    status,
  },
});

describe("PullRequestArtifact", () => {
  it("renders an <a> tag with correct href for IN_PROGRESS (Open) status", () => {
    render(<PullRequestArtifact artifact={makeArtifact("IN_PROGRESS")} />);
    const link = screen.getByRole("link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://github.com/org/repo/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Open");
  });

  it("renders an <a> tag with correct href for DONE (Merged) status", () => {
    render(<PullRequestArtifact artifact={makeArtifact("DONE")} />);
    const link = screen.getByRole("link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://github.com/org/repo/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Merged");
  });

  it("renders an <a> tag with correct href for CANCELLED (Closed) status", () => {
    render(<PullRequestArtifact artifact={makeArtifact("CANCELLED")} />);
    const link = screen.getByRole("link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://github.com/org/repo/pull/42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Closed");
  });

  it("does not call window.open on click", () => {
    const openSpy = vi.spyOn(window, "open");
    render(<PullRequestArtifact artifact={makeArtifact("IN_PROGRESS")} />);
    const link = screen.getByRole("link");
    link.click();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
