// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ConceptsPanel } from "@/components/agent-logs/LogDetailContent";
import type { SessionReflection } from "@/lib/utils/agent-log-stats";

const baseReflection: SessionReflection = {
  session_id: "sess-1",
  updated_at: "2026-08-10T00:00:00.000Z",
  concepts: [
    { ref_id: "c1", name: "Task dual status", read_order: 1, rank: 1, evidence: "used in turn 3" },
    { ref_id: "c2", name: "Pusher channels", read_order: 2, rank: null },
  ],
  gap: "blob payload shape",
};

describe("ConceptsPanel", () => {
  it("renders concept names, counts, and the gap line", () => {
    render(<ConceptsPanel reflection={baseReflection} />);
    expect(screen.getByText("Concepts")).toBeTruthy();
    expect(screen.getByText("2 read · 1 ranked")).toBeTruthy();
    expect(screen.getByText("Task dual status")).toBeTruthy();
    expect(screen.getByText("Pusher channels")).toBeTruthy();
    expect(screen.getByText("blob payload shape")).toBeTruthy();
  });

  it("omits the ranked count when no concept is ranked", () => {
    render(
      <ConceptsPanel
        reflection={{ concepts: [{ ref_id: "c1", name: "Only read", rank: null }] }}
      />,
    );
    expect(screen.getByText("1 read")).toBeTruthy();
  });

  it("renders nothing when there are no concepts", () => {
    const { container } = render(<ConceptsPanel reflection={{ concepts: [], gap: "still a gap" }} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a raw-only reflection (no concepts key)", () => {
    const { container } = render(<ConceptsPanel reflection={{ raw: "unparseable model output" }} />);
    expect(container.innerHTML).toBe("");
  });

  it("skips concepts with no name, ref_id, or id", () => {
    const { container } = render(
      <ConceptsPanel reflection={{ concepts: [{ rank: null }, { rank: 1 }] }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("falls back to ref_id when a concept has no name", () => {
    render(<ConceptsPanel reflection={{ concepts: [{ ref_id: "ref-42", rank: null }] }} />);
    expect(screen.getByText("ref-42")).toBeTruthy();
  });
});
