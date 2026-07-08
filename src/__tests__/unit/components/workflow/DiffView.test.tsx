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
    stepA: { name: "A", timeout: 20 }, // modified
    stepC: { name: "C" }, // added
    // stepB removed
  },
  connections: [{ source: "stepA", target: "stepC" }],
});

describe("DiffView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty / null states ──────────────────────────────────────────────────────

  describe("empty / null states", () => {
    it("shows 'no data available' message when both inputs are null", () => {
      render(<DiffView original={null} updated={null} label="workflow" />);
      expect(screen.getByText(/no workflow data available/i)).toBeInTheDocument();
    });

    it("shows generic label in no-data message", () => {
      render(<DiffView original={null} updated={null} label="prompt" />);
      expect(screen.getByText(/no prompt data available/i)).toBeInTheDocument();
    });

    it("renders all-green additions when only updated is provided (no original)", () => {
      render(<DiffView original={null} updated={updatedJson} label="workflow" />);
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBeGreaterThan(0);
    });

    it("shows 'no updated content' message when only original is provided", () => {
      render(<DiffView original={originalJson} updated={null} label="workflow" />);
      expect(screen.getByText(/no updated workflow/i)).toBeInTheDocument();
    });

    it("shows 'no changes detected' when both inputs are identical", () => {
      render(<DiffView original={originalJson} updated={originalJson} label="workflow" />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
    });

    it("shows label in 'identical' message", () => {
      render(<DiffView original={originalJson} updated={originalJson} label="prompt" />);
      expect(screen.getByText(/the prompt is identical/i)).toBeInTheDocument();
    });
  });

  // ── Toggle buttons ───────────────────────────────────────────────────────────

  describe("toggle buttons", () => {
    it("renders both toggle buttons", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      expect(screen.getByRole("button", { name: /changes only/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /full/i })).toBeInTheDocument();
    });

    it("defaults to diff mode ('Changes only' active)", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      const btn = screen.getByRole("button", { name: /changes only/i });
      expect(btn.className).toContain("bg-muted");
    });

    it("switches to full mode when second button is clicked", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      const fullBtn = screen.getByRole("button", { name: /full/i });
      fireEvent.click(fullBtn);
      expect(fullBtn.className).toContain("bg-muted");
    });
  });

  // ── Additions / deletions counts ─────────────────────────────────────────────

  describe("stats display", () => {
    it("shows addition and deletion counts in the header", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      const statsArea = document.querySelector(".flex.items-center.gap-1.text-xs");
      expect(statsArea).not.toBeNull();
    });

    it("shows all additions when original is null", () => {
      const text = "line one\nline two\nline three";
      render(<DiffView original={null} updated={text} label="script" />);
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBeGreaterThan(0);
      const redRows = document.querySelectorAll("tr.bg-red-50");
      expect(redRows.length).toBe(0);
    });
  });

  // ── Diff mode (default) ──────────────────────────────────────────────────────

  describe("diff mode (default)", () => {
    it("renders added and removed rows", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      const table = document.querySelector("table");
      const allRows = table?.querySelectorAll("tr") ?? [];
      expect(allRows.length).toBeGreaterThan(0);
      const hasGreen = Array.from(allRows).some((r) => r.className.includes("bg-green"));
      const hasRed = Array.from(allRows).some((r) => r.className.includes("bg-red"));
      expect(hasGreen).toBe(true);
      expect(hasRed).toBe(true);
    });

    it("shows context rows and a separator for large unchanged gaps", () => {
      const bigUnchanged = Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`key${i}`, `value${i}`]),
      );
      const orig = makeJson({ first: "original", ...bigUnchanged, last: "original" });
      const upd = makeJson({ first: "updated", ...bigUnchanged, last: "updated" });

      render(<DiffView original={orig} updated={upd} label="workflow" />);
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];

      const hasContextRow = Array.from(allRows).some(
        (r) =>
          !r.className.includes("bg-green") &&
          !r.className.includes("bg-red") &&
          r.textContent?.trim() !== "...",
      );
      expect(hasContextRow).toBe(true);

      const hasSeparator = Array.from(allRows).some((r) => r.textContent?.trim() === "...");
      expect(hasSeparator).toBe(true);
    });

    it("no separator when two changes are separated by exactly 10 unchanged lines", () => {
      const tenLines = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`mid${i}`, i]),
      );
      const orig = makeJson({ first: "A", ...tenLines, last: "A" });
      const upd = makeJson({ first: "B", ...tenLines, last: "B" });

      render(<DiffView original={orig} updated={upd} label="workflow" />);
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      const hasSep = Array.from(allRows).some((r) => r.textContent?.trim() === "...");
      expect(hasSep).toBe(false);
    });

    it("separator present when two changes are separated by more than 10 unchanged lines", () => {
      const elevenLines = Object.fromEntries(
        Array.from({ length: 11 }, (_, i) => [`mid${i}`, i]),
      );
      const orig = makeJson({ first: "A", ...elevenLines, last: "A" });
      const upd = makeJson({ first: "B", ...elevenLines, last: "B" });

      render(<DiffView original={orig} updated={upd} label="workflow" />);
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      const hasSep = Array.from(allRows).some((r) => r.textContent?.trim() === "...");
      expect(hasSep).toBe(true);
    });
  });

  // ── Full mode ────────────────────────────────────────────────────────────────

  describe("full mode (after toggle)", () => {
    it("renders unchanged lines after switching to full view", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      fireEvent.click(screen.getByRole("button", { name: /full/i }));

      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      expect(allRows.length).toBeGreaterThan(0);
      const hasNeutralRow = Array.from(allRows).some(
        (r) => !r.className.includes("bg-green") && !r.className.includes("bg-red"),
      );
      expect(hasNeutralRow).toBe(true);
    });

    it("still shows changed lines with colour in full mode", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      fireEvent.click(screen.getByRole("button", { name: /full/i }));
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      const hasColored = Array.from(allRows).some(
        (r) => r.className.includes("bg-green") || r.className.includes("bg-red"),
      );
      expect(hasColored).toBe(true);
    });
  });

  // ── Plain text (prompt / script bodies) ──────────────────────────────────────

  describe("plain text diffing (prompt / script)", () => {
    const originalText =
      "You are a helpful assistant.\nAlways be concise.\nDo not hallucinate.";
    const updatedText =
      "You are a helpful assistant.\nAlways be concise and accurate.\nDo not hallucinate.";

    it("diffs plain multi-line text without treating it as JSON", () => {
      render(<DiffView original={originalText} updated={updatedText} label="prompt" />);
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      const hasGreen = Array.from(allRows).some((r) => r.className.includes("bg-green"));
      const hasRed = Array.from(allRows).some((r) => r.className.includes("bg-red"));
      expect(hasGreen).toBe(true);
      expect(hasRed).toBe(true);
    });

    it("shows 'no changes detected' for identical plain text", () => {
      render(<DiffView original={originalText} updated={originalText} label="script" />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
      expect(screen.getByText(/the script is identical/i)).toBeInTheDocument();
    });

    it("renders all-additions for new prompt (no original)", () => {
      render(<DiffView original={null} updated={originalText} label="prompt" />);
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBeGreaterThan(0);
    });
  });

  // ── Object-typed props (regression: object-typed workflowJson) ───────────────

  describe("object-typed original/updated (regression: TypeError crash)", () => {
    it("renders without throwing when both props are plain objects", () => {
      const original = { nodes: [] };
      const updated = { nodes: [{ id: "1" }] };
      expect(() =>
        render(<DiffView original={original} updated={updated} label="workflow" />),
      ).not.toThrow();
    });

    it("produces visible diff content when both props are plain objects", () => {
      const original = { nodes: [] };
      const updated = { nodes: [{ id: "1" }] };
      render(<DiffView original={original} updated={updated} label="workflow" />);
      // Should render the diff table with at least one coloured row
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      expect(allRows.length).toBeGreaterThan(0);
    });

    it("renders without throwing when original is null and updated is a plain object", () => {
      expect(() =>
        render(<DiffView original={null} updated={{ nodes: [{ id: "1" }] }} label="workflow" />),
      ).not.toThrow();
    });

    it("existing string behaviour unaffected — still diffs JSON strings correctly", () => {
      render(<DiffView original={originalJson} updated={updatedJson} label="workflow" />);
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      const hasColored = Array.from(allRows).some(
        (r) => r.className.includes("bg-green") || r.className.includes("bg-red"),
      );
      expect(hasColored).toBe(true);
    });

    it("existing null behaviour unaffected — null/null still shows no-data message", () => {
      render(<DiffView original={null} updated={null} label="workflow" />);
      expect(screen.getByText(/no workflow data available/i)).toBeInTheDocument();
    });

    it("existing plain-text behaviour unaffected — plain text still diffs without throwing", () => {
      const orig = "You are a helpful assistant.\nBe concise.";
      const upd = "You are a helpful assistant.\nBe concise and accurate.";
      expect(() =>
        render(<DiffView original={orig} updated={upd} label="prompt" />),
      ).not.toThrow();
      const greenRows = document.querySelectorAll("tr.bg-green-50");
      expect(greenRows.length).toBeGreaterThan(0);
    });
  });

  // ── Noise field filtering (workflow JSON) ─────────────────────────────────────

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

      render(<DiffView original={orig} updated={upd} label="workflow" />);
      expect(screen.getByText(/no changes detected/i)).toBeInTheDocument();
    });

    it("surfaces real changes but omits noise-field lines", () => {
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
            position: { x: 100, y: 200 },
            unique_id: "uid-2",
            subskill_id: "sub-2",
            skill_icon: "icon-b",
          },
        },
      });

      render(<DiffView original={orig} updated={upd} label="workflow" />);
      const allRows = document.querySelector("table")?.querySelectorAll("tr") ?? [];
      const coloredRows = Array.from(allRows).filter(
        (r) => r.className.includes("bg-green") || r.className.includes("bg-red"),
      );
      expect(coloredRows.length).toBeGreaterThan(0);

      const noiseFields = ["position", "unique_id", "subskill_id", "skill_icon"];
      for (const field of noiseFields) {
        const noiseInColored = coloredRows.some((r) =>
          r.textContent?.includes(`"${field}"`),
        );
        expect(noiseInColored).toBe(false);
      }
    });
  });
});
