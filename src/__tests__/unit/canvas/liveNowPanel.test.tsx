import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";import { LiveNowPanel } from "@/app/org/[githubLogin]/connections/LiveNowPanel";
import type { LiveNowRow } from "@/app/org/[githubLogin]/connections/useLiveNowItems";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

/**
 * Component tests for the org-canvas "Live Now" panel.
 *
 * The panel is pure presentation over `LiveNowRow[]` props: these tests
 * cover the empty-state precedence, collapse toggle, group-header
 * hiding, and the two click paths (deep-link command vs. link fallback)
 * without mounting the canvas.
 */

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<LiveNowRow> & Pick<LiveNowRow, "key" | "title" | "label">): LiveNowRow {
  return {
    nodeId: "",
    canvasRef: "",
    fallbackOnly: false,
    link: "",
    colorHex: "#f59e0b",
    iconName: null,
    order: 0,
    running: null,
    ...overrides,
  };
}

const attentionRow = () =>
  makeRow({
    key: "node:feature:f1",
    nodeId: "feature:f1",
    canvasRef: "initiative:i1",
    link: "/w/ws-alpha/tasks/t1",
    title: "Halted Task",
    label: "Halted",
    iconName: "alert-triangle",
  });

const runningRow = () =>
  makeRow({
    key: "node:feature:f2",
    nodeId: "feature:f2",
    canvasRef: "initiative:i1",
    title: "Building Feature",
    label: "Planner working",
    colorHex: "#f59e0b",
    running: { plannerRunning: true, agentsRunningCount: 0 },
  });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let triggerDeeplink: ReturnType<typeof vi.fn>;
let windowOpen: MockInstance<Window["open"]>;

beforeEach(() => {
  triggerDeeplink = vi.fn();
  // The panel reads `triggerDeeplink` from the shared canvas chat store
  // (same command channel the chat's deeplink chips use) — swap in a
  // spy for the duration of each test.
  useCanvasChatStore.setState({ triggerDeeplink });
  windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
  windowOpen.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LiveNowPanel — empty state", () => {
  it("renders nothing at all when the row list is empty", () => {
    const { container } = render(
      <LiveNowPanel rows={[]} overflowCount={0} lastUpdatedAt={0} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("LiveNowPanel — collapse toggle", () => {
  it("collapses to the header and re-expands", () => {
    render(
      <LiveNowPanel
        rows={[attentionRow(), runningRow()]}
        overflowCount={0}
        lastUpdatedAt={Date.now()}
      />,
    );

    const toggle = screen.getByRole("button", { name: /live now/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Halted Task")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Halted Task")).toBeNull();
    expect(screen.queryByText("Building Feature")).toBeNull();
    // Header (with count) stays visible while collapsed.
    expect(screen.getByText("Live Now")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByText("Halted Task")).toBeTruthy();
    expect(screen.getByText("Building Feature")).toBeTruthy();
  });
});

describe("LiveNowPanel — groups", () => {
  it("hides a group header when that group has no rows", () => {
    render(
      <LiveNowPanel rows={[runningRow()]} overflowCount={0} lastUpdatedAt={0} />,
    );

    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText("Needs you")).toBeNull();
  });

  it("shows both group headers in order when both groups have rows", () => {
    render(
      <LiveNowPanel
        rows={[attentionRow(), runningRow()]}
        overflowCount={0}
        lastUpdatedAt={0}
      />,
    );

    const needsYou = screen.getByText("Needs you");
    const running = screen.getByText("Running");
    // "Needs you" precedes "Running" in DOM order.
    expect(needsYou.compareDocumentPosition(running) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the +N more overflow hint", () => {
    render(
      <LiveNowPanel
        rows={[attentionRow()]}
        overflowCount={3}
        lastUpdatedAt={0}
      />,
    );
    expect(screen.getByText("+3 more")).toBeTruthy();
  });
});

describe("LiveNowPanel — row clicks", () => {
  it("fallbackOnly row opens its link in a new tab and does NOT dispatch a deep link", () => {
    const fallbackRow = makeRow({
      key: "item:t9",
      nodeId: "", // task with no parent feature — nothing to focus
      fallbackOnly: true,
      link: "/w/ws-alpha/tasks/t9",
      title: "Orphan Task",
      label: "Halted",
      iconName: "alert-triangle",
    });
    render(
      <LiveNowPanel rows={[fallbackRow]} overflowCount={0} lastUpdatedAt={0} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Orphan Task/ }));

    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith(
      "/w/ws-alpha/tasks/t9",
      "_blank",
      "noopener,noreferrer",
    );
    expect(triggerDeeplink).not.toHaveBeenCalled();
  });

  it("non-fallback row dispatches the deep-link command through the store", () => {
    render(
      <LiveNowPanel
        rows={[attentionRow()]}
        overflowCount={0}
        lastUpdatedAt={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Halted Task/ }));

    expect(triggerDeeplink).toHaveBeenCalledTimes(1);
    expect(triggerDeeplink).toHaveBeenCalledWith({
      nodeId: "feature:f1",
      canvasRef: "initiative:i1",
      label: "Halted Task",
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("running row dispatches a deep link (focus-first, no fallback link)", () => {
    render(
      <LiveNowPanel rows={[runningRow()]} overflowCount={0} lastUpdatedAt={0} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Building Feature/ }));

    expect(triggerDeeplink).toHaveBeenCalledWith({
      nodeId: "feature:f2",
      canvasRef: "initiative:i1",
      label: "Building Feature",
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });
});

describe("LiveNowPanel — running indicators", () => {
  it("shows a secondary running indicator on an attention row with concurrent live activity", () => {
    const concurrent = attentionRow();
    concurrent.running = { plannerRunning: false, agentsRunningCount: 2 };
    render(
      <LiveNowPanel rows={[concurrent]} overflowCount={0} lastUpdatedAt={0} />,
    );

    // Secondary indicator is titled with the formatted running label.
    expect(screen.getByTitle("2 agents running")).toBeTruthy();
    // The row's primary label is still the attention signal's.
    expect(screen.getByText("Halted")).toBeTruthy();
  });
});

describe("LiveNowPanel — freshness footer", () => {
  it("renders a relative 'updated Ns ago' footer once the ticker starts", async () => {
    render(
      <LiveNowPanel
        rows={[attentionRow()]}
        overflowCount={0}
        lastUpdatedAt={Date.now() - 5000}
      />,
    );

    // The ticker effect fills `now` in right after mount.
    expect(await screen.findByText(/Updated 5s ago/)).toBeTruthy();
  });
});
