// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ConceptsPanel } from "@/components/agent-logs/LogDetailContent";
import type { SessionReflection } from "@/types/agent-logs";

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

  it("links concepts with a gitree id to the Learn page in a new tab", () => {
    render(
      <ConceptsPanel
        workspaceSlug="openlaw"
        reflection={{
          concepts: [
            {
              id: "stakwork/claude-for-legal/legal-document-type-review-memo",
              ref_id: "a4903a86",
              name: "Review Memo",
              rank: null,
            },
          ],
        }}
      />,
    );
    const link = screen.getByText("Review Memo").closest("a");
    expect(link).toBeTruthy();
    // Double-encoded: the Learn page decodes the param twice (searchParams.get
    // + decodeURIComponent) before matching against concept ids.
    expect(link?.getAttribute("href")).toBe(
      "/w/openlaw/learn?concept=stakwork%252Fclaude-for-legal%252Flegal-document-type-review-memo",
    );
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("does not link concepts without a gitree id, even with a slug", () => {
    render(
      <ConceptsPanel
        workspaceSlug="openlaw"
        reflection={{ concepts: [{ ref_id: "graph-only", name: "Graph only", rank: null }] }}
      />,
    );
    expect(screen.getByText("Graph only").closest("a")).toBeNull();
  });

  it("does not link concepts when no workspace slug is provided", () => {
    render(
      <ConceptsPanel
        reflection={{ concepts: [{ id: "org/repo/thing", name: "Thing", rank: null }] }}
      />,
    );
    expect(screen.getByText("Thing").closest("a")).toBeNull();
  });
});
