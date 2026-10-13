// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { startNewOrgConversation } = vi.hoisted(() => ({ startNewOrgConversation: vi.fn() }));
vi.mock("@/app/org/[githubLogin]/_state/openOrgConversation", () => ({ startNewOrgConversation }));

// Render the popover body inline — Radix would only mount it while open.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/AutomationsSection", () => ({ AutomationsSection: () => null }));

import { CanvasAgentSettingsPopover } from "@/app/org/[githubLogin]/_components/CanvasAgentSettingsPopover";

const KEY = "hive.jamieSlimPrompt";

describe("CanvasAgentSettingsPopover — concept mode switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => null }) as unknown as typeof fetch;
  });
  afterEach(() => cleanup());

  it("is labelled as the A/B test and starts off", () => {
    render(<CanvasAgentSettingsPopover githubLogin="acme" />);
    const sw = screen.getByRole("switch", { name: "Concept mode (A/B test)" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Concept mode (A/B test)")).toBeTruthy();
  });

  it("reads the value the slim-prompt switch stored under the same key", () => {
    window.localStorage.setItem(KEY, "true");
    render(<CanvasAgentSettingsPopover githubLogin="acme" />);
    expect(screen.getByRole("switch", { name: "Concept mode (A/B test)" }).getAttribute("aria-checked")).toBe("true");
  });

  it("flipping it stores the value and starts a new chat", () => {
    render(<CanvasAgentSettingsPopover githubLogin="acme" />);
    fireEvent.click(screen.getByRole("switch", { name: "Concept mode (A/B test)" }));
    expect(window.localStorage.getItem(KEY)).toBe("true");
    expect(startNewOrgConversation).toHaveBeenCalledWith("acme");

    fireEvent.click(screen.getByRole("switch", { name: "Concept mode (A/B test)" }));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(startNewOrgConversation).toHaveBeenCalledTimes(2);
  });
});
