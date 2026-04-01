import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StakworkRunDropdown } from "@/components/StakworkRunDropdown";

describe("StakworkRunDropdown", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders with workflowId pre-provided and does not fetch", async () => {
    const user = userEvent.setup();

    render(
      <StakworkRunDropdown
        projectId="123"
        workflowId={42}
        hiveUrl="https://example.com/current-page"
        variant="button"
      />
    );

    // Open dropdown
    const trigger = screen.getByRole("button", { name: /stak run/i });
    await user.click(trigger);

    // Confirm no fetch was made
    expect(global.fetch).not.toHaveBeenCalled();

    // Verify "View Workflow in Stak" is enabled with correct href
    const workflowItem = screen.getByRole("menuitem", { name: /view workflow in stak/i });
    expect(workflowItem).not.toHaveAttribute("aria-disabled", "true");
    expect(workflowItem.closest("a")).toHaveAttribute(
      "href",
      "https://jobs.stakwork.com/admin/workflows/42/edit"
    );
    expect(workflowItem.closest("a")).toHaveAttribute("target", "_blank");
    expect(workflowItem.closest("a")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders without workflowId, fetches successfully, and enables workflow item", async () => {
    const user = userEvent.setup();

    // Mock successful fetch
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { project: { workflow_id: 99 } },
      }),
    });

    render(
      <StakworkRunDropdown
        projectId="456"
        hiveUrl="https://example.com/current-page"
        variant="button"
      />
    );

    // Open dropdown
    const trigger = screen.getByRole("button", { name: /stak run/i });
    await user.click(trigger);

    // Confirm fetch was called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/stakwork/projects/456");
    });

    // Wait for loading state to complete and check href
    await waitFor(() => {
      const workflowItem = screen.getByRole("menuitem", { name: /view workflow in stak/i });
      expect(workflowItem).not.toHaveAttribute("aria-disabled", "true");
      expect(workflowItem.closest("a")).toHaveAttribute(
        "href",
        "https://jobs.stakwork.com/admin/workflows/99/edit"
      );
    });
  });

  it("renders without workflowId, fetch fails, and shows workflow unavailable", async () => {
    const user = userEvent.setup();

    // Mock failed fetch
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

    render(
      <StakworkRunDropdown
        projectId="789"
        hiveUrl="https://example.com/current-page"
        variant="button"
      />
    );

    // Open dropdown
    const trigger = screen.getByRole("button", { name: /stak run/i });
    await user.click(trigger);

    // Wait for error state — item is disabled and has no <a>
    await waitFor(() => {
      const workflowItem = screen.getByRole("menuitem", { name: /workflow unavailable/i });
      expect(workflowItem).toHaveAttribute("aria-disabled", "true");
      expect(workflowItem.closest("a")).toBeNull();
    });
  });

  it("does not re-fetch on second open (cached state)", async () => {
    const user = userEvent.setup();

    // Mock successful fetch
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { project: { workflow_id: 55 } },
      }),
    });

    render(
      <StakworkRunDropdown
        projectId="111"
        hiveUrl="https://example.com/current-page"
        variant="button"
      />
    );

    // First open
    const trigger = screen.getByRole("button", { name: /stak run/i });
    await user.click(trigger);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Close dropdown
    await user.keyboard("{Escape}");

    // Second open
    await user.click(trigger);

    // Confirm fetch was NOT called again
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("renders as button when variant is 'button'", () => {
    render(
      <StakworkRunDropdown
        projectId="123"
        workflowId={42}
        hiveUrl="https://example.com/current-page"
        variant="button"
      />
    );

    const trigger = screen.getByRole("button", { name: /stak run/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger.tagName).toBe("BUTTON");
  });

  it("renders as inline link when variant is 'link'", () => {
    render(
      <StakworkRunDropdown
        projectId="123"
        workflowId={42}
        hiveUrl="https://example.com/current-page"
        variant="link"
      />
    );

    const trigger = screen.getByRole("button", { name: /stak run/i });
    expect(trigger).toBeInTheDocument();
    // Check for the link-style classes
    expect(trigger.className).toContain("text-xs");
    expect(trigger.className).toContain("text-muted-foreground");
  });

  it("opens all three menu items with correct hrefs", async () => {
    const user = userEvent.setup();

    render(
      <StakworkRunDropdown
        projectId="123"
        workflowId={42}
        hiveUrl="https://example.com/hive-page"
        variant="button"
      />
    );

    // Open dropdown
    const trigger = screen.getByRole("button", { name: /stak run/i });
    await user.click(trigger);

    // Check "View Run on Hive" anchor
    const hiveItem = screen.getByRole("menuitem", { name: /view run on hive/i });
    expect(hiveItem.closest("a")).toHaveAttribute("href", "https://example.com/hive-page");
    expect(hiveItem.closest("a")).toHaveAttribute("target", "_blank");
    expect(hiveItem.closest("a")).toHaveAttribute("rel", "noopener noreferrer");

    // Check "View Run on Stak" anchor
    const stakItem = screen.getByRole("menuitem", { name: /view run on stak/i });
    expect(stakItem.closest("a")).toHaveAttribute(
      "href",
      "https://jobs.stakwork.com/admin/projects/123"
    );
    expect(stakItem.closest("a")).toHaveAttribute("target", "_blank");
    expect(stakItem.closest("a")).toHaveAttribute("rel", "noopener noreferrer");

    // Check "View Workflow in Stak" anchor
    const workflowItem = screen.getByRole("menuitem", { name: /view workflow in stak/i });
    expect(workflowItem.closest("a")).toHaveAttribute(
      "href",
      "https://jobs.stakwork.com/admin/workflows/42/edit"
    );
    expect(workflowItem.closest("a")).toHaveAttribute("target", "_blank");
    expect(workflowItem.closest("a")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("workflow item has no <a> and is disabled while loading", async () => {
    const user = userEvent.setup();

    // Mock a fetch that never resolves (stays loading)
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {})
    );

    render(
      <StakworkRunDropdown
        projectId="222"
        hiveUrl="https://example.com/current-page"
        variant="button"
      />
    );

    const trigger = screen.getByRole("button", { name: /stak run/i });
    await user.click(trigger);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/stakwork/projects/222");
    });

    // While loading, the item should be disabled with no <a>
    const workflowItem = screen.getByRole("menuitem", { name: /view workflow in stak/i });
    expect(workflowItem).toHaveAttribute("aria-disabled", "true");
    expect(workflowItem.closest("a")).toBeNull();
  });
});
