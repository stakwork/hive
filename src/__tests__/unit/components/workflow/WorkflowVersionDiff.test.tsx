// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowVersionDiff } from "@/components/workflow/inspector/WorkflowVersionDiff";

// Mock WorkflowChangesPanel to keep tests isolated
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/WorkflowChangesPanel", () => ({
  WorkflowChangesPanel: () => <div data-testid="workflow-changes-panel">Full JSON Diff</div>,
}));

// Mock useTheme (used transitively by WorkflowChangesPanel)
vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function makeWorkflowJson(vars: Record<string, unknown>): string {
  return JSON.stringify({
    transitions: {
      step1: {
        attributes: { vars },
      },
    },
  });
}

const jsonWithABC = makeWorkflowJson({ keyA: "val-a", keyB: "val-b", keyC: "val-c" });
const jsonWithAB = makeWorkflowJson({ keyA: "val-a", keyB: "val-b" });
const jsonWithABmodified = makeWorkflowJson({ keyA: "val-a-changed", keyB: "val-b" });
const jsonEmpty = makeWorkflowJson({});

describe("WorkflowVersionDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("added-only diff", () => {
    it("renders green rows for added keys and no red/amber rows", () => {
      // prev: AB, curr: ABC → keyC is added
      render(<WorkflowVersionDiff previousJson={jsonWithAB} currentJson={jsonWithABC} />);

      // Should have a green row with '+'
      const rows = document.querySelectorAll("tr");
      const greenRows = Array.from(rows).filter((r) =>
        r.className.includes("green"),
      );
      expect(greenRows.length).toBe(1);
      expect(screen.getByText("keyC")).toBeInTheDocument();

      // No red or amber rows
      const redRows = Array.from(rows).filter((r) => r.className.includes("red"));
      const amberRows = Array.from(rows).filter((r) => r.className.includes("amber"));
      expect(redRows.length).toBe(0);
      expect(amberRows.length).toBe(0);
    });
  });

  describe("removed-only diff", () => {
    it("renders red rows for removed keys and no green/amber rows", () => {
      // prev: ABC, curr: AB → keyC is removed
      render(<WorkflowVersionDiff previousJson={jsonWithABC} currentJson={jsonWithAB} />);

      const rows = document.querySelectorAll("tr");
      const redRows = Array.from(rows).filter((r) => r.className.includes("red"));
      expect(redRows.length).toBe(1);
      expect(screen.getByText("keyC")).toBeInTheDocument();

      const greenRows = Array.from(rows).filter((r) => r.className.includes("green"));
      const amberRows = Array.from(rows).filter((r) => r.className.includes("amber"));
      expect(greenRows.length).toBe(0);
      expect(amberRows.length).toBe(0);
    });
  });

  describe("modified-only diff", () => {
    it("renders amber rows for modified keys and no green/red rows", () => {
      // prev: AB, curr: AB (A value changed) → keyA modified
      render(
        <WorkflowVersionDiff previousJson={jsonWithAB} currentJson={jsonWithABmodified} />,
      );

      const rows = document.querySelectorAll("tr");
      const amberRows = Array.from(rows).filter((r) => r.className.includes("amber"));
      expect(amberRows.length).toBe(1);
      expect(screen.getByText("keyA")).toBeInTheDocument();

      const greenRows = Array.from(rows).filter((r) => r.className.includes("green"));
      const redRows = Array.from(rows).filter((r) => r.className.includes("red"));
      expect(greenRows.length).toBe(0);
      expect(redRows.length).toBe(0);
    });
  });

  describe("no diff", () => {
    it("renders 'No set_var changes in this version.' when there are no changes", () => {
      render(<WorkflowVersionDiff previousJson={jsonWithAB} currentJson={jsonWithAB} />);
      expect(
        screen.getByText(/no set_var changes in this version/i),
      ).toBeInTheDocument();
    });

    it("renders no-change message when both inputs are null", () => {
      render(<WorkflowVersionDiff previousJson={null} currentJson={null} />);
      expect(
        screen.getByText(/no set_var changes in this version/i),
      ).toBeInTheDocument();
    });

    it("renders no-change message when both inputs have no vars", () => {
      render(<WorkflowVersionDiff previousJson={jsonEmpty} currentJson={jsonEmpty} />);
      expect(
        screen.getByText(/no set_var changes in this version/i),
      ).toBeInTheDocument();
    });
  });

  describe("Show full JSON diff toggle", () => {
    it("mounts WorkflowChangesPanel when 'Show full JSON diff' is clicked", () => {
      render(<WorkflowVersionDiff previousJson={jsonWithAB} currentJson={jsonWithABC} />);

      expect(screen.queryByTestId("workflow-changes-panel")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /show full json diff/i }));

      expect(screen.getByTestId("workflow-changes-panel")).toBeInTheDocument();
    });

    it("unmounts WorkflowChangesPanel when clicked again", () => {
      render(<WorkflowVersionDiff previousJson={jsonWithAB} currentJson={jsonWithABC} />);

      fireEvent.click(screen.getByRole("button", { name: /show full json diff/i }));
      expect(screen.getByTestId("workflow-changes-panel")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /hide full json diff/i }));
      expect(screen.queryByTestId("workflow-changes-panel")).toBeNull();
    });
  });
});
