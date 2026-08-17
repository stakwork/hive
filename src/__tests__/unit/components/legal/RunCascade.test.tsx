import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CascadeTrace } from "@/components/legal/RunCascade";
import { assembleRunCascade } from "@/lib/legal-cascade/derive";
import {
  buildMockSessionMap,
  buildMockTurnsBySession,
  MOCK_PLAN_SESSION_ID,
  MOCK_PLAN_CHILD_ID,
  MOCK_REPAIR_SESSION_ID,
} from "@/lib/legal-cascade/fixtures";

function mockModel() {
  return assembleRunCascade(
    [...buildMockSessionMap("147813394").values()],
    buildMockTurnsBySession(),
  );
}

describe("CascadeTrace", () => {
  it("renders one section per top-level agent with the child spliced in", () => {
    render(<CascadeTrace model={mockModel()} />);

    expect(screen.getByTestId(`cascade-agent-${MOCK_PLAN_SESSION_ID}`)).toBeDefined();
    expect(screen.getByTestId(`cascade-agent-${MOCK_REPAIR_SESSION_ID}`)).toBeDefined();
    // The sub-agent header row inside the plan section.
    expect(screen.getByTestId(`cascade-agent-${MOCK_PLAN_CHILD_ID}`)).toBeDefined();
  });

  it("renders concept chips for READ and display-parsed CREATED actions", () => {
    render(<CascadeTrace model={mockModel()} />);

    expect(screen.getByTestId("cascade-concept-onto-1").textContent).toContain(
      "wfa-ontology",
    );
    expect(screen.getByTestId("cascade-concept-cc-1").textContent).toContain(
      "contract-clauses",
    );
    const created = screen.getByTestId("cascade-concept-indemnification-scope");
    expect(created.textContent).toContain("+ CREATED");
  });

  it("renders the summary strip from the model", () => {
    render(<CascadeTrace model={mockModel()} />);
    const strip = screen.getByTestId("cascade-summary-strip");
    expect(strip.textContent).toContain("agents2");
    expect(strip.textContent).toContain("sub-agents1");
    expect(strip.textContent).toContain("concepts3");
  });

  it("unrolls a pill on click and folds it back", () => {
    render(<CascadeTrace model={mockModel()} />);

    // Plan session's first pill spans orders 1–4 (2 calls + 2 results — one
    // result carries a concept and is excluded; reasoning at 1).
    const pillTestId = `cascade-pill-${MOCK_PLAN_SESSION_ID}-1`;
    const detailTestId = `cascade-row-detail-${MOCK_PLAN_SESSION_ID}-2`;
    expect(screen.queryByTestId(detailTestId)).toBeNull();

    fireEvent.click(screen.getByTestId(pillTestId));
    expect(screen.getByTestId(detailTestId)).toBeDefined();

    fireEvent.click(screen.getByTestId(pillTestId));
    expect(screen.queryByTestId(detailTestId)).toBeNull();
  });

  it("reveals the sub-agent's turn-0 prompt when its header is clicked", () => {
    render(<CascadeTrace model={mockModel()} />);

    const promptTestId = `cascade-row-prompt-${MOCK_PLAN_CHILD_ID}`;
    expect(screen.queryByTestId(promptTestId)).toBeNull();

    fireEvent.click(screen.getByTestId(`cascade-agent-${MOCK_PLAN_CHILD_ID}`));
    expect(screen.getByTestId(promptTestId).textContent).toContain(
      "Map every clause",
    );
  });

  it("expand all unrolls every pill; collapse all folds them", () => {
    render(<CascadeTrace model={mockModel()} />);

    const button = screen.getByTestId("cascade-expand-all");
    fireEvent.click(button);
    expect(button.textContent).toBe("collapse all");
    // A detail row from the repair session's pill is now visible.
    expect(
      screen.getByTestId(`cascade-row-detail-${MOCK_REPAIR_SESSION_ID}-1`),
    ).toBeDefined();

    fireEvent.click(button);
    expect(
      screen.queryByTestId(`cascade-row-detail-${MOCK_REPAIR_SESSION_ID}-1`),
    ).toBeNull();
  });
});
