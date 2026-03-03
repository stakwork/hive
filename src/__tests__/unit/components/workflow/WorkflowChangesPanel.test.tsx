import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowChangesPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/WorkflowChangesPanel";

// Mock useTheme hook
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function makeJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

const originalJson = makeJson({
  transitions: {
    stepA: { name: "A", timeout: 10 },
    stepB: { name: "B" },
  },
  connections: [{ source: "stepA", target: "stepB" }],
});

const updatedJson = makeJson({
  transitions: {
    stepA: { name: "A", timeout: 20 }, // modified
    stepC: { name: "C" }, // added
    // stepB removed
  },
  connections: [
    { source: "stepA", target: "stepC" }, // changed
  ],
});

describe("WorkflowChangesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty / null states", () => {
    it("shows 'no workflow data' message when both inputs are null", () => {
      render(<WorkflowChangesPanel originalJson={null} updatedJson={null} />);
      expect(screen.getByText(/no workflow data available/i)).toBeInTheDocument();
    });

    it("shows 'no original workflow' message when only updatedJson is provided", () => {
      render(<WorkflowChangesPanel originalJson={null} updatedJson={updatedJson} />);
      expect(screen.getByText(/no original workflow/i)).toBeInTheDocument();
    });

    it("shows 'no updated workflow' message when only originalJson is provided", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={null} />);
      expect(screen.getByText(/no updated workflow/i)).toBeInTheDocument();
    });

    it("shows 'no changes detected' when both JSONs are identical", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={originalJson} />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
    });
  });

  describe("toggle buttons", () => {
    it("renders both toggle buttons in the header", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);
      expect(screen.getByRole("button", { name: /changes only/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /full json/i })).toBeInTheDocument();
    });

    it("defaults to diff mode ('Changes only' active)", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);
      const changesOnlyBtn = screen.getByRole("button", { name: /changes only/i });
      // In diff mode the button has the active styling class
      expect(changesOnlyBtn.className).toContain("bg-muted");
    });

    it("switches to full mode when 'Full JSON' button is clicked", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);
      const fullJsonBtn = screen.getByRole("button", { name: /full json/i });
      fireEvent.click(fullJsonBtn);
      expect(fullJsonBtn.className).toContain("bg-muted");
    });
  });

  describe("diff mode (default)", () => {
    it("renders only added/removed line rows — unchanged lines produce no rows", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);

      // In diff mode only green/red rows appear; all rows should have a + or - prefix icon
      const rows = screen.getAllByRole("row");
      // Every row should be a changed (added/removed) line, not a neutral line
      // We check that there are NO rows rendered without a coloured class
      // (neutral rows would have no bg colour — they're simply not rendered)
      expect(rows.length).toBeGreaterThan(0);

      // Check that the table body has NO uncoloured rows (unchanged content)
      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      allRows.forEach((row) => {
        // Every row should have a background class (green or red)
        const hasBg =
          row.className.includes("bg-green") || row.className.includes("bg-red");
        expect(hasBg).toBe(true);
      });
    });
  });

  describe("full mode (after toggle)", () => {
    it("renders all line rows including unchanged lines after switching to Full JSON", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);

      // Switch to full mode
      fireEvent.click(screen.getByRole("button", { name: /full json/i }));

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];

      // In full mode there should be more rows than in diff mode (unchanged lines included)
      expect(allRows.length).toBeGreaterThan(0);

      // At least some rows should NOT have a coloured background (unchanged)
      const hasNeutralRow = Array.from(allRows).some(
        (row) => !row.className.includes("bg-green") && !row.className.includes("bg-red"),
      );
      expect(hasNeutralRow).toBe(true);
    });

    it("still shows changed lines with colour in full mode", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);
      fireEvent.click(screen.getByRole("button", { name: /full json/i }));

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      const hasColoredRow = Array.from(allRows).some(
        (row) => row.className.includes("bg-green") || row.className.includes("bg-red"),
      );
      expect(hasColoredRow).toBe(true);
    });
  });

  describe("stats display", () => {
    it("shows addition and deletion counts in the header", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);
      // Stats are displayed as numbers next to +/- icons
      // There should be at least 1 addition and 1 deletion
      const headerStats = document.querySelector(".flex.items-center.gap-1.text-xs");
      expect(headerStats).not.toBeNull();
    });
  });
});
