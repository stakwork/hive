// @vitest-environment jsdom
/**
 * Unit tests for `StrutProposalCard` — a strut proposal's card: the record
 * read live through hive's route, the body drawn per step (hive's graph
 * card body for `graph/create-node`), the rationale, the status badge, and
 * a decision posted to the decide route and reflected from its answer. Also
 * the pending card and result line of `OrchestratorTurnCard`.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({ useSendCanvasChatMessage: () => vi.fn() }));
vi.mock("@/app/org/[githubLogin]/_components/PublishPromptSlot", () => ({
  PublishPromptSlot: () => null,
  derivePublishState: vi.fn(),
  resolveLegacyVersion: vi.fn(),
  publishPromptVersion: vi.fn(),
}));

import { StrutProposalBody, StrutProposalCard } from "@/app/org/[githubLogin]/_components/StrutProposalCard";
import {
  PendingOrchestratorTurnCard,
  StrutProposalResultRow,
  pendingOrchestratorLaunchIds,
} from "@/app/org/[githubLogin]/_components/OrchestratorTurnCard";

const mockFetch = vi.fn();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SOURCE = {
  kind: "proposal" as const,
  runId: "row-1",
  proposalId: "p1",
  url: "/proposals/p1",
  step: "graph/create-node",
  status: "pending" as const,
  title: "Create a node in the strut knowledge graph.",
  rationale: "The Rate limits page is missing.",
};
const RECORD = {
  id: "p1",
  step: "graph/create-node",
  input: { node_type: "Concept", node_data: { name: "Rate limits", description: "How limits are enforced" } },
  rationale: "The Rate limits page is missing.",
  title: "Create a node in the strut knowledge graph.",
  status: "pending",
  createdAt: "2026-10-19T13:02:30Z",
  by: { workflow: "orchestrator", runId: "179" },
  workspaceSlug: "acme",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue(json(200, { proposal: RECORD }));
});

describe("StrutProposalBody", () => {
  it("draws graph/create-node with hive's node-create body, the input as pairs for an unknown step", () => {
    const { unmount } = render(
      <StrutProposalBody step="graph/create-node" input={RECORD.input} workspaceSlug="acme" />,
    );
    expect(screen.getByText("Concept")).toBeTruthy();
    expect(screen.getByText('"Rate limits"')).toBeTruthy();
    unmount();
    render(<StrutProposalBody step="memory/remember" input={{ text: "remember this" }} />);
    expect(screen.getByTestId("strut-proposal-generic-body").textContent).toContain("remember this");
  });
});

describe("StrutProposalCard", () => {
  it("reads the record for the turn, draws the step's input, the rationale and the status, and decides on strut", async () => {
    render(<StrutProposalCard source={SOURCE} githubLogin="acme-org" />);
    expect(screen.getByText("Proposed new graph node")).toBeTruthy();
    expect(screen.getByText(SOURCE.title)).toBeTruthy();

    await waitFor(() => expect(screen.getByText('"Rate limits"')).toBeTruthy());
    expect(mockFetch).toHaveBeenCalledWith("/api/orgs/acme-org/strut/proposals/p1?run=row-1");
    expect(screen.getByText("The Rate limits page is missing.")).toBeTruthy();
    expect(screen.getByText("Awaiting your decision")).toBeTruthy();
    expect(screen.getByTestId("strut-proposal-card").getAttribute("data-status")).toBe("pending");

    mockFetch.mockResolvedValueOnce(
      json(200, {
        proposal: {
          ...RECORD,
          status: "applied",
          decision: { action: "accept", at: "x" },
          result: { output: { ref_id: "n1" }, at: "y" },
        },
      }),
    );
    fireEvent.click(screen.getByLabelText("Approve"));
    await waitFor(() => expect(screen.getByText("Applied")).toBeTruthy());
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/orgs/acme-org/strut/proposals/p1/decide");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ runId: "row-1", action: "accept" });
    expect(screen.queryByLabelText("Approve")).toBeNull();
    expect(screen.queryByLabelText("Reject")).toBeNull();
  });

  it("a failed proposal offers Accept again; a 409 refreshes the card from strut's record", async () => {
    mockFetch.mockResolvedValueOnce(
      json(200, { proposal: { ...RECORD, status: "failed", result: { error: "node_key missing", at: "y" } } }),
    );
    render(<StrutProposalCard source={SOURCE} githubLogin="acme-org" />);
    await waitFor(() => expect(screen.getByLabelText("Accept again")).toBeTruthy());
    expect(screen.getByTestId("strut-proposal-error").textContent).toBe("node_key missing");
    expect(screen.queryByLabelText("Reject")).toBeNull();

    mockFetch.mockResolvedValueOnce(
      json(409, { error: "already decided", proposal: { ...RECORD, status: "applied" } }),
    );
    fireEvent.click(screen.getByLabelText("Accept again"));
    await waitFor(() => expect(screen.getByText("Applied")).toBeTruthy());
    expect(screen.getByText("already decided")).toBeTruthy();
  });

  it("a record hive cannot read still shows the brief, with the error", async () => {
    mockFetch.mockResolvedValueOnce(json(502, { error: "Could not reach strut" }));
    render(<StrutProposalCard source={SOURCE} githubLogin="acme-org" />);
    await waitFor(() => expect(screen.getByText("Could not reach strut")).toBeTruthy());
    expect(screen.getByText(SOURCE.title)).toBeTruthy();
    expect(screen.queryByLabelText("Approve")).toBeNull();
  });
});

describe("OrchestratorTurnCard", () => {
  it("a launch marker is pending until its reply row is in the conversation", () => {
    const launch = {
      id: "orchestrator-launch-row-1",
      source: { kind: "orchestrator_launch" as const, runId: "row-1" },
    };
    expect(pendingOrchestratorLaunchIds([launch])).toEqual(new Set(["orchestrator-launch-row-1"]));
    expect(
      pendingOrchestratorLaunchIds([
        launch,
        {
          id: "orchestrator-row-1",
          source: { kind: "orchestrator" as const, runId: "row-1", strutRunId: "1", status: "success" as const },
        },
      ]),
    ).toEqual(new Set());
    render(<PendingOrchestratorTurnCard source={launch.source} />);
    expect(screen.getByTestId("orchestrator-turn-pending-card").textContent).toContain("Jamie is working on it");
  });

  it("a decision is a quiet line", () => {
    render(
      <StrutProposalResultRow
        message={{ content: "Applied: Create a node." }}
        source={{
          kind: "proposal_result",
          runId: "row-1",
          proposalId: "p1",
          status: "applied",
          title: "Create a node.",
        }}
      />,
    );
    expect(screen.getByTestId("strut-proposal-result-row").textContent).toContain("Applied: Create a node.");
  });
});
