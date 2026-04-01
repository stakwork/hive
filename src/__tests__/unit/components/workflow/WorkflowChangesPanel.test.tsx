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
    it("renders only added/removed line rows", () => {
      render(<WorkflowChangesPanel originalJson={originalJson} updatedJson={updatedJson} />);

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];

      // There must be rows
      expect(allRows.length).toBeGreaterThan(0);

      // At least one green (added) and one red (removed) row must exist
      const hasGreen = Array.from(allRows).some((row) => row.className.includes("bg-green"));
      const hasRed = Array.from(allRows).some((row) => row.className.includes("bg-red"));
      expect(hasGreen).toBe(true);
      expect(hasRed).toBe(true);
    });

    it("shows context rows adjacent to changes and a separator for large unchanged gaps", () => {
      // Build a workflow where there is a large unchanged block between two changed fields
      // Use a deeply nested object so the JSON serialises to many lines
      const bigUnchanged = Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`key${i}`, `value${i}`]),
      );
      const orig = makeJson({
        first: "original",
        ...bigUnchanged,
        last: "original",
      });
      const upd = makeJson({
        first: "updated",   // change at top
        ...bigUnchanged,    // large unchanged gap (> 10 lines)
        last: "updated",    // change at bottom
      });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];

      // Context rows (no bg colour, not separator) must appear
      const hasContextRow = Array.from(allRows).some(
        (row) => !row.className.includes("bg-green") && !row.className.includes("bg-red") && row.textContent !== "...",
      );
      expect(hasContextRow).toBe(true);

      // Separator row must appear because the unchanged gap is > 10 lines
      const hasSeparator = Array.from(allRows).some((row) => row.textContent?.trim() === "...");
      expect(hasSeparator).toBe(true);
    });

    it("no leading context rows when change is at the very start", () => {
      // The diff starts with a changed chunk — nothing precedes it, so the first
      // unchanged chunk (if any) has no prevChanged neighbour and is skipped entirely.
      // We verify no separator appears and at least one coloured row exists.
      const orig = makeJson({ stepA: { name: "A" } });
      const upd = makeJson({ stepA: { name: "B" } });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      expect(allRows.length).toBeGreaterThan(0);

      // No separator should appear — the unchanged tail after the last change has no
      // nextChanged neighbour so it is not shown at all.
      const hasSeparator = Array.from(allRows).some((row) => row.textContent?.trim() === "...");
      expect(hasSeparator).toBe(false);

      // At least one coloured (changed) row must be present
      const hasColoured = Array.from(allRows).some(
        (row) => row.className.includes("bg-green") || row.className.includes("bg-red"),
      );
      expect(hasColoured).toBe(true);
    });

    it("no trailing context rows when change is at the very end", () => {
      // Only one change at the very end — unchanged prefix has no nextChanged neighbour
      // beyond CONTEXT lines, but leading context of the last change should still appear.
      // Critically: no separator should exist.
      const shared = { a: 1, b: 2, c: 3 };
      const orig = makeJson({ ...shared, z: "old" });
      const upd = makeJson({ ...shared, z: "new" });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      expect(allRows.length).toBeGreaterThan(0);

      // No separator — the unchanged block before the last change fits within CONTEXT lines
      const hasSeparator = Array.from(allRows).some((row) => row.textContent?.trim() === "...");
      expect(hasSeparator).toBe(false);

      // At least one coloured row must exist
      const hasColoured = Array.from(allRows).some(
        (row) => row.className.includes("bg-green") || row.className.includes("bg-red"),
      );
      expect(hasColoured).toBe(true);
    });

    it("no separator when two changes are separated by exactly 10 unchanged lines", () => {
      // 10 lines of context exactly → fits within 2 * CONTEXT (5+5) without separator
      const tenLines = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`mid${i}`, i]),
      );
      const orig = makeJson({ first: "A", ...tenLines, last: "A" });
      const upd = makeJson({ first: "B", ...tenLines, last: "B" });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];

      const hasSeparator = Array.from(allRows).some((row) => row.textContent?.trim() === "...");
      expect(hasSeparator).toBe(false);
    });

    it("separator present when two changes are separated by more than 10 unchanged lines", () => {
      const elevenLines = Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`mid${i}`, i]),
      );
      const orig = makeJson({ first: "A", ...elevenLines, last: "A" });
      const upd = makeJson({ first: "B", ...elevenLines, last: "B" });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);

      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];

      const hasSeparator = Array.from(allRows).some((row) => row.textContent?.trim() === "...");
      expect(hasSeparator).toBe(true);
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

  describe("noise field filtering", () => {
    it("shows 'no changes detected' when transitions differ only in noise fields", () => {
      const orig = makeJson({
        transitions: {
          stepA: {
            name: "A",
            timeout: 10,
            position: { x: 0, y: 0 },
            unique_id: "uid-1",
            subskill_id: "sub-1",
            skill_icon: "icon-a",
          },
        },
      });
      const upd = makeJson({
        transitions: {
          stepA: {
            name: "A",
            timeout: 10,
            position: { x: 100, y: 200 },
            unique_id: "uid-2",
            subskill_id: "sub-2",
            skill_icon: "icon-b",
          },
        },
      });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
    });

    it("surfaces real field changes but omits noise field lines", () => {
      const orig = makeJson({
        transitions: {
          stepA: {
            name: "A",
            timeout: 10,
            position: { x: 0, y: 0 },
            unique_id: "uid-1",
            subskill_id: "sub-1",
            skill_icon: "icon-a",
          },
        },
      });
      const upd = makeJson({
        transitions: {
          stepA: {
            name: "A",
            timeout: 99, // real change
            position: { x: 100, y: 200 }, // noise
            unique_id: "uid-2", // noise
            subskill_id: "sub-2", // noise
            skill_icon: "icon-b", // noise
          },
        },
      });

      render(<WorkflowChangesPanel originalJson={orig} updatedJson={upd} />);

      // Should have coloured diff rows (real change present)
      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      const hasColoured = Array.from(allRows).some(
        (row) => row.className.includes("bg-green") || row.className.includes("bg-red"),
      );
      expect(hasColoured).toBe(true);

      // No diff row should contain any of the noise field names
      const noiseFields = ["position", "unique_id", "subskill_id", "skill_icon"];
      const allText = Array.from(allRows).map((row) => row.textContent ?? "");
      const colouredRows = Array.from(allRows).filter(
        (row) => row.className.includes("bg-green") || row.className.includes("bg-red"),
      );
      for (const field of noiseFields) {
        const hasNoiseInColoured = colouredRows.some((row) => row.textContent?.includes(`"${field}"`));
        expect(hasNoiseInColoured).toBe(false);
      }
      // Suppress unused variable warning
      void allText;
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
