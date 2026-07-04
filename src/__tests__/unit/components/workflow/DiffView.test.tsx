import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "@/app/w/[slug]/task/[...taskParams]/artifacts/changes/DiffView";

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
    stepA: { name: "A", timeout: 20 },
    stepC: { name: "C" },
  },
  connections: [{ source: "stepA", target: "stepC" }],
});

describe("DiffView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty / null states ──────────────────────────────────────────────────────

  describe("empty / null states", () => {
    it("shows 'no data' message when both inputs are null", () => {
      render(<DiffView original={null} updated={null} label="workflow" />);
      expect(screen.getByText(/no workflow data available/i)).toBeInTheDocument();
    });

    it("uses generic label in the no-data message", () => {
      render(<DiffView original={null} updated={null} label="prompt" />);
      expect(screen.getByText(/no prompt data available/i)).toBeInTheDocument();
    });

    it("renders all-green additions when only updated is provided (no original)", () => {
      render(<DiffView original={null} updated={updatedJson} label="workflow" />);
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBeGreaterThan(0);
    });

    it("shows 'no updated' message when only original is provided", () => {
      render(<DiffView original={originalJson} updated={null} label="workflow" />);
      expect(screen.getByText(/no updated workflow/i)).toBeInTheDocument();
    });

    it("shows 'no changes detected' when both inputs are identical", () => {
      render(<DiffView original={originalJson} updated={originalJson} label="workflow" />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
    });

    it("shows generic label in 'identical' sub-message", () => {
      render(<DiffView original="hello" updated="hello" label="prompt" />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
      expect(screen.getByText(/the prompt is identical/i)).toBeInTheDocument();
    });
  });

  // ── Toggle buttons ───────────────────────────────────────────────────────────

  describe("toggle buttons", () => {
    it("renders 'Changes only' and a full-content toggle", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      expect(screen.getByRole("button", { name: /changes only/i })).toBeInTheDocument();
      // For JSON content the full toggle says "Full JSON"
      expect(screen.getByRole("button", { name: /full json/i })).toBeInTheDocument();
    });

    it("defaults to diff mode ('Changes only' active)", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      const changesOnlyBtn = screen.getByRole("button", { name: /changes only/i });
      expect(changesOnlyBtn.className).toContain("bg-muted");
    });

    it("switches to full mode when full-content button is clicked", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      const fullBtn = screen.getByRole("button", { name: /full json/i });
      fireEvent.click(fullBtn);
      expect(fullBtn.className).toContain("bg-muted");
    });

    it("shows 'Full content' toggle label for plain-text input", () => {
      render(<DiffView original="line one\nline two" updated="line one\nline three" label="prompt" />);
      expect(screen.getByRole("button", { name: /full content/i })).toBeInTheDocument();
    });
  });

  // ── Additions / deletions stats ──────────────────────────────────────────────

  describe("additions/deletions stats", () => {
    it("shows non-zero stats in the header for a real diff", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      const statsContainer = document.querySelector(".flex.items-center.gap-1.text-xs");
      expect(statsContainer).not.toBeNull();
    });

    it("counts plain-text additions correctly", () => {
      // Use consistent trailing newlines so diffLines treats "line one\n" as unchanged
      render(
        <DiffView
          original={"line one\n"}
          updated={"line one\nline two\nline three\n"}
          label="script"
        />,
      );
      // "line two" and "line three" are additions → 2 green rows, 0 red rows
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBe(2);
      const redRows = document.querySelectorAll("tr.bg-red-50");
      expect(redRows.length).toBe(0);
    });

    it("shows label in header", () => {
      render(<DiffView original="a" updated="b" label="script" />);
      expect(screen.getByText(/script changes/i)).toBeInTheDocument();
    });
  });

  // ── Diff mode (context-line collapsing) ──────────────────────────────────────

  describe("diff mode context lines", () => {
    it("renders added and removed rows", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      expect(allRows.length).toBeGreaterThan(0);
      const hasGreen = Array.from(allRows).some((r) => r.className.includes("bg-green"));
      const hasRed = Array.from(allRows).some((r) => r.className.includes("bg-red"));
      expect(hasGreen).toBe(true);
      expect(hasRed).toBe(true);
    });

    it("shows separator '...' when two changes are separated by more than 10 unchanged lines", () => {
      const elevenLines = Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`mid${i}`, i]),
      );
      const orig = makeJson({ first: "A", ...elevenLines, last: "A" });
      const upd = makeJson({ first: "B", ...elevenLines, last: "B" });

      render(<DiffView original={orig} updated={upd} />);
      const hasSeparator = Array.from(document.querySelectorAll("tr")).some(
        (row) => row.textContent?.trim() === "...",
      );
      expect(hasSeparator).toBe(true);
    });

    it("does NOT show separator when two changes are separated by exactly 10 unchanged lines", () => {
      const tenLines = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`mid${i}`, i]),
      );
      const orig = makeJson({ first: "A", ...tenLines, last: "A" });
      const upd = makeJson({ first: "B", ...tenLines, last: "B" });

      render(<DiffView original={orig} updated={upd} />);
      const hasSeparator = Array.from(document.querySelectorAll("tr")).some(
        (row) => row.textContent?.trim() === "...",
      );
      expect(hasSeparator).toBe(false);
    });

    it("works for plain-text with >10 unchanged lines between two changes", () => {
      const sharedLines = Array.from({ length: 15 }, (_, i) => `unchanged line ${i}`);
      const original = ["first: old", ...sharedLines, "last: old"].join("\n");
      const updated = ["first: new", ...sharedLines, "last: new"].join("\n");

      render(<DiffView original={original} updated={updated} label="script" />);
      const hasSeparator = Array.from(document.querySelectorAll("tr")).some(
        (row) => row.textContent?.trim() === "...",
      );
      expect(hasSeparator).toBe(true);
    });
  });

  // ── Full mode ────────────────────────────────────────────────────────────────

  describe("full mode (after toggle)", () => {
    it("renders unchanged rows in full mode", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      fireEvent.click(screen.getByRole("button", { name: /full json/i }));

      const allRows = document.querySelectorAll("tr");
      const hasNeutralRow = Array.from(allRows).some(
        (row) => !row.className.includes("bg-green") && !row.className.includes("bg-red"),
      );
      expect(hasNeutralRow).toBe(true);
    });

    it("still shows coloured rows in full mode", () => {
      render(<DiffView original={originalJson} updated={updatedJson} />);
      fireEvent.click(screen.getByRole("button", { name: /full json/i }));

      const allRows = document.querySelectorAll("tr");
      const hasColoured = Array.from(allRows).some(
        (row) => row.className.includes("bg-green") || row.className.includes("bg-red"),
      );
      expect(hasColoured).toBe(true);
    });
  });

  // ── JSON noise-field filtering ───────────────────────────────────────────────

  describe("noise field filtering (workflow JSON)", () => {
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

      render(<DiffView original={orig} updated={upd} label="workflow" />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
    });
  });

  // ── Plain-text passthrough ───────────────────────────────────────────────────

  describe("plain-text passthrough", () => {
    it("diffs plain prompt text without JSON parsing", () => {
      const original = "You are a helpful assistant.\nAlways be concise.";
      const updatedText = "You are a helpful assistant.\nAlways be detailed and thorough.";

      render(<DiffView original={original} updated={updatedText} label="prompt" />);
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      const redRows = document.querySelectorAll("tr.bg-red-50");
      expect(greenRows.length).toBeGreaterThan(0);
      expect(redRows.length).toBeGreaterThan(0);
    });

    it("diffs plain script code", () => {
      const original = "def run():\n    return 1";
      const updatedCode = "def run():\n    return 42";

      render(<DiffView original={original} updated={updatedCode} label="script" />);
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBeGreaterThan(0);
    });
  });
});
