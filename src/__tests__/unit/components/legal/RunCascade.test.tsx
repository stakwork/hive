import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("renders same-batch agents as parallel siblings and separate batches without the wrapper", () => {
    // Pull the two top-level agents into the same start-time window.
    const sessions = [...buildMockSessionMap("147813394").values()].map((s) =>
      s.agent_name.startsWith("repair-agent")
        ? { ...s, timestamp: new Date(Date.parse(s.timestamp) - 120_000 + 200).toISOString() }
        : s,
    );
    const parallel = assembleRunCascade(sessions, buildMockTurnsBySession());
    const { unmount } = render(<CascadeTrace model={parallel} />);
    expect(screen.getByTestId("cascade-batch-0").textContent).toContain("parallel ×2");
    unmount();

    // The stock fixture starts them 2 minutes apart — no batch wrapper.
    render(<CascadeTrace model={mockModel()} />);
    expect(screen.queryByTestId("cascade-batch-0")).toBeNull();
  });

  it("opens a concept peek on chip click, fetching the node for the workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          ref_id: "onto-1",
          node_type: "Concept",
          name: "wfa-ontology",
          id: "g-1",
          properties: { docs: "The WFA clause ontology." },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CascadeTrace model={mockModel()} workspaceSlug="acme" />);
    expect(screen.queryByTestId("cascade-concept-peek")).toBeNull();

    fireEvent.click(screen.getByTestId("cascade-concept-onto-1"));

    const peek = await screen.findByTestId("cascade-concept-peek");
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/acme/nodes/onto-1");
    await waitFor(() => {
      expect(peek.textContent).toContain("The WFA clause ontology.");
    });
    // Identity the trace carries plus what the graph knows.
    expect(peek.textContent).toContain("wfa-ontology");
    expect(peek.textContent).toContain("onto-1");
    expect(peek.textContent).toContain("g-1");
  });

  it("says why a concept peek cannot fetch without a workspace", async () => {
    render(<CascadeTrace model={mockModel()} />);

    fireEvent.click(screen.getByTestId("cascade-concept-onto-1"));

    const peek = await screen.findByTestId("cascade-concept-peek");
    expect(peek.textContent).toContain("Live node fetch needs a workspace context.");
  });

  it("offers a graph deep link from the peek, keyed on the concept's ref_id", async () => {
    render(<CascadeTrace model={mockModel()} workspaceSlug="acme" />);

    fireEvent.click(screen.getByTestId("cascade-concept-onto-1"));

    await screen.findByTestId("cascade-concept-peek");
    const link = screen.getByTestId("node-peek-view-in-graph");
    // `?ref_id=` is what puts the explorer into walk mode on load.
    expect(link).toHaveAttribute("href", "/w/acme/context/graph?ref_id=onto-1");
  });

  it("omits the graph link when there is no workspace to link into", async () => {
    render(<CascadeTrace model={mockModel()} />);

    fireEvent.click(screen.getByTestId("cascade-concept-onto-1"));

    await screen.findByTestId("cascade-concept-peek");
    expect(screen.queryByTestId("node-peek-view-in-graph")).toBeNull();
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
