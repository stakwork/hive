// @vitest-environment jsdom
/**
 * Unit tests for DocxTabBar.
 *
 * Covers:
 *  - Renders all tab labels
 *  - Calls onTabChange when a tab is clicked
 *  - Calls onTabClose when the close button is clicked
 *  - Arrow buttons are invisible (class "invisible") when not scrollable
 *  - Arrow buttons appear (not invisible) when the strip overflows
 *  - Clicking right arrow calls scrollBy with a positive left value
 *  - Clicking left arrow calls scrollBy with a negative left value
 *  - Virtual tabs show "RO" badge
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DocxTabBar, { DocxTab } from "@/components/docx-editor/DocxTabBar";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("@/lib/utils", () => ({
  cn: (...args: (string | boolean | undefined | null)[]) =>
    args.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="icon-x">×</span>,
  ChevronLeft: () => <span data-testid="icon-chevron-left">‹</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">›</span>,
  GitCompare: () => <span data-testid="icon-git-compare">⇄</span>,
  FileText: () => <span data-testid="icon-file-text">📄</span>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const TABS: DocxTab[] = [
  { id: "tab-1", label: "contract.docx", kind: "document" },
  { id: "tab-2", label: "redline.docx", kind: "document" },
  { id: "tab-3", label: "Blackline: A ↔ B", kind: "blackline" },
];

function renderBar(
  overrides: Partial<{
    tabs: DocxTab[];
    activeId: string;
    onTabChange: (id: string) => void;
    onTabClose: (id: string) => void;
  }> = {}
) {
  const onTabChange = vi.fn();
  const onTabClose = vi.fn();

  const result = render(
    <DocxTabBar
      tabs={overrides.tabs ?? TABS}
      activeId={overrides.activeId ?? "tab-1"}
      onTabChange={overrides.onTabChange ?? onTabChange}
      onTabClose={overrides.onTabClose ?? onTabClose}
    />
  );

  return { ...result, onTabChange, onTabClose };
}

/**
 * Simulate overflow by making scrollWidth > clientWidth on the scroll container.
 * jsdom doesn't do layout, so we mock the properties directly.
 */
function setScrollContainerOverflow(
  container: HTMLElement,
  opts: { scrollWidth?: number; clientWidth?: number; scrollLeft?: number } = {}
) {
  const scrollDiv = container.querySelector<HTMLElement>(
    "[style*='scrollbar-width']"
  );
  if (!scrollDiv) return;

  Object.defineProperty(scrollDiv, "scrollWidth", {
    configurable: true,
    value: opts.scrollWidth ?? 800,
  });
  Object.defineProperty(scrollDiv, "clientWidth", {
    configurable: true,
    value: opts.clientWidth ?? 300,
  });
  Object.defineProperty(scrollDiv, "scrollLeft", {
    configurable: true,
    writable: true,
    value: opts.scrollLeft ?? 0,
  });

  // Mock scrollBy
  scrollDiv.scrollBy = vi.fn();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DocxTabBar — basic rendering", () => {
  it("renders all tab labels", () => {
    renderBar();
    expect(screen.getByText("contract.docx")).toBeInTheDocument();
    expect(screen.getByText("redline.docx")).toBeInTheDocument();
    expect(screen.getByText(/Blackline/)).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected=true", () => {
    renderBar({ activeId: "tab-2" });
    const tabs = screen.getAllByRole("tab");
    const activeTab = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    expect(activeTab).toBeDefined();
    expect(activeTab?.textContent).toContain("redline.docx");
  });

  it("shows 'RO' badge on virtual (non-document) tabs", () => {
    renderBar();
    // The blackline tab has kind: "blackline"
    const roBadges = screen.getAllByText("RO");
    expect(roBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT show 'RO' badge on document tabs", () => {
    const docOnlyTabs: DocxTab[] = [
      { id: "d1", label: "doc.docx", kind: "document" },
    ];
    renderBar({ tabs: docOnlyTabs, activeId: "d1" });
    expect(screen.queryByText("RO")).toBeNull();
  });
});

describe("DocxTabBar — tab interactions", () => {
  it("calls onTabChange with the tab id when a tab is clicked", () => {
    const { onTabChange } = renderBar();
    const tab = screen.getByText("redline.docx").closest("[role='tab']")!;
    fireEvent.click(tab);
    expect(onTabChange).toHaveBeenCalledWith("tab-2");
  });

  it("calls onTabClose when the close (×) button is clicked", () => {
    const { onTabClose } = renderBar({ activeId: "tab-1" });
    // Each tab has a close button — get the first one's aria-label
    const closeBtn = screen.getByRole("button", { name: "Close contract.docx" });
    fireEvent.click(closeBtn);
    expect(onTabClose).toHaveBeenCalledWith("tab-1");
  });

  it("does not call onTabChange when clicking the close button", () => {
    const { onTabChange, onTabClose } = renderBar();
    const closeBtn = screen.getByRole("button", { name: "Close contract.docx" });
    fireEvent.click(closeBtn);
    expect(onTabChange).not.toHaveBeenCalled();
    expect(onTabClose).toHaveBeenCalledOnce();
  });
});

describe("DocxTabBar — scroll arrows when NOT overflowing", () => {
  it("left arrow is invisible when scrollLeft = 0", () => {
    const { container } = renderBar();
    const leftBtn = container.querySelector<HTMLElement>(
      "[data-testid='tab-scroll-left']"
    );
    // The component uses "invisible" class when canScrollLeft is false
    expect(leftBtn?.className).toContain("invisible");
  });

  it("right arrow is invisible when content fits (scrollWidth ≤ clientWidth)", () => {
    const { container } = renderBar();
    // jsdom: scrollWidth and clientWidth are both 0 by default → no overflow
    const rightBtn = container.querySelector<HTMLElement>(
      "[data-testid='tab-scroll-right']"
    );
    expect(rightBtn?.className).toContain("invisible");
  });
});

describe("DocxTabBar — scroll arrows when overflowing", () => {
  it("right arrow becomes visible after triggering a scroll event with overflow", async () => {
    const { container } = renderBar();
    const scrollDiv = container.querySelector<HTMLElement>(
      "[style*='scrollbar-width']"
    )!;

    // Set up overflow layout
    Object.defineProperty(scrollDiv, "scrollWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollDiv, "clientWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(scrollDiv, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });

    // Fire scroll to trigger updateScrollState
    await act(async () => {
      fireEvent.scroll(scrollDiv);
    });

    const rightBtn = container.querySelector<HTMLElement>(
      "[data-testid='tab-scroll-right']"
    );
    // Should no longer be invisible
    expect(rightBtn?.className).not.toContain("invisible");
  });

  it("left arrow becomes visible when scrollLeft > 0", async () => {
    const { container } = renderBar();
    const scrollDiv = container.querySelector<HTMLElement>(
      "[style*='scrollbar-width']"
    )!;

    Object.defineProperty(scrollDiv, "scrollWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollDiv, "clientWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(scrollDiv, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 100, // has scrolled right
    });

    await act(async () => {
      fireEvent.scroll(scrollDiv);
    });

    const leftBtn = container.querySelector<HTMLElement>(
      "[data-testid='tab-scroll-left']"
    );
    expect(leftBtn?.className).not.toContain("invisible");
  });
});

describe("DocxTabBar — clicking arrows calls scrollBy", () => {
  it("clicking right arrow calls scrollBy with positive left", async () => {
    const { container } = renderBar();
    const scrollDiv = container.querySelector<HTMLElement>(
      "[style*='scrollbar-width']"
    )!;
    const mockScrollBy = vi.fn();
    scrollDiv.scrollBy = mockScrollBy;

    // Make it look like there's overflow so arrow is clickable
    Object.defineProperty(scrollDiv, "scrollWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollDiv, "clientWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(scrollDiv, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });

    await act(async () => {
      fireEvent.scroll(scrollDiv);
    });

    const rightBtn = container.querySelector<HTMLElement>(
      "[data-testid='tab-scroll-right']"
    )!;
    fireEvent.click(rightBtn);
    expect(mockScrollBy).toHaveBeenCalledWith({ left: 160, behavior: "smooth" });
  });

  it("clicking left arrow calls scrollBy with negative left", async () => {
    const { container } = renderBar();
    const scrollDiv = container.querySelector<HTMLElement>(
      "[style*='scrollbar-width']"
    )!;
    const mockScrollBy = vi.fn();
    scrollDiv.scrollBy = mockScrollBy;

    Object.defineProperty(scrollDiv, "scrollWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollDiv, "clientWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(scrollDiv, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 200,
    });

    await act(async () => {
      fireEvent.scroll(scrollDiv);
    });

    const leftBtn = container.querySelector<HTMLElement>(
      "[data-testid='tab-scroll-left']"
    )!;
    fireEvent.click(leftBtn);
    expect(mockScrollBy).toHaveBeenCalledWith({ left: -160, behavior: "smooth" });
  });
});
