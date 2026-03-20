import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArtifactsHeader } from "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsHeader";
import { ArtifactType } from "@/lib/chat";

// Mock lucide-react icons used by ArtifactsHeader
vi.mock("lucide-react", () => ({
  Monitor: ({ className }: { className?: string }) => <svg data-testid="icon-monitor" className={className} />,
  Network: ({ className }: { className?: string }) => <svg data-testid="icon-network" className={className} />,
  FileCode: ({ className }: { className?: string }) => <svg data-testid="icon-filecode" className={className} />,
  Code2: ({ className }: { className?: string }) => <svg data-testid="icon-code2" className={className} />,
  Terminal: ({ className }: { className?: string }) => <svg data-testid="icon-terminal" className={className} />,
  ClipboardList: ({ className }: { className?: string }) => <svg data-testid="icon-clipboardlist" className={className} />,
  ListChecks: ({ className }: { className?: string }) => <svg data-testid="icon-listchecks" className={className} />,
  ShieldCheck: ({ className }: { className?: string }) => <svg data-testid="icon-shieldcheck" className={className} />,
}));

vi.mock("react-icons/pi", () => ({
  PiGraphFill: ({ className }: { className?: string }) => <svg data-testid="icon-graph" className={className} />,
}));

vi.mock("@/components/ui/tooltip", () => {
  const React = require("react");
  return {
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <div role="tooltip">{children}</div>,
  };
});

const availableArtifacts: ArtifactType[] = ["PLAN", "TASKS", "VERIFY"];

describe("ArtifactsHeader - disabledTabs prop", () => {
  test("renders VERIFY button as disabled with tooltip when disabledTabs includes VERIFY", () => {
    render(
      <ArtifactsHeader
        availableArtifacts={availableArtifacts}
        activeArtifact="PLAN"
        onArtifactChange={vi.fn()}
        disabledTabs={["VERIFY"]}
      />
    );

    // Find the Verify button by its text
    const verifyButton = screen.getByText("Verify").closest("button");
    expect(verifyButton).not.toBeNull();
    expect(verifyButton).toBeDisabled();

    // Tooltip content should be present in the DOM (radix renders it in portal)
    expect(screen.getByText("No screenshots yet — run a task to generate them")).toBeInTheDocument();
  });

  test("renders VERIFY button as enabled (not disabled) when disabledTabs is empty", () => {
    const onArtifactChange = vi.fn();
    render(
      <ArtifactsHeader
        availableArtifacts={availableArtifacts}
        activeArtifact="PLAN"
        onArtifactChange={onArtifactChange}
        disabledTabs={[]}
      />
    );

    const verifyButton = screen.getByText("Verify").closest("button");
    expect(verifyButton).not.toBeNull();
    expect(verifyButton).not.toBeDisabled();
  });

  test("renders VERIFY button as enabled when disabledTabs prop is omitted", () => {
    render(
      <ArtifactsHeader
        availableArtifacts={availableArtifacts}
        activeArtifact="PLAN"
        onArtifactChange={vi.fn()}
      />
    );

    const verifyButton = screen.getByText("Verify").closest("button");
    expect(verifyButton).not.toBeNull();
    expect(verifyButton).not.toBeDisabled();
  });

  test("PLAN and TASKS tabs remain enabled when only VERIFY is disabled", () => {
    render(
      <ArtifactsHeader
        availableArtifacts={availableArtifacts}
        activeArtifact="PLAN"
        onArtifactChange={vi.fn()}
        disabledTabs={["VERIFY"]}
      />
    );

    const planButton = screen.getByText("Plan").closest("button");
    const tasksButton = screen.getByText("Tasks").closest("button");
    expect(planButton).not.toBeDisabled();
    expect(tasksButton).not.toBeDisabled();
  });

  test("tooltip is NOT shown when VERIFY tab is enabled", () => {
    render(
      <ArtifactsHeader
        availableArtifacts={availableArtifacts}
        activeArtifact="PLAN"
        onArtifactChange={vi.fn()}
        disabledTabs={[]}
      />
    );

    expect(
      screen.queryByText("No screenshots yet — run a task to generate them")
    ).not.toBeInTheDocument();
  });
});
