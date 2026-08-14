import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConceptProposalChip } from "@/components/graph-explorer/chat/ConceptProposalChip";
import type { ConceptProposal } from "@/types/concept-proposals";

function proposal(overrides: Partial<ConceptProposal>): ConceptProposal {
  return {
    id: "p1",
    action: "update",
    status: "pending",
    rationale: "Because the docs drifted.",
    source: "graph_chat",
    prNumbers: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    repo: "stakwork/hive",
    ...overrides,
  };
}

describe("ConceptProposalChip", () => {
  it("renders the action badge, rationale, and the Learn deep link", () => {
    render(
      <ConceptProposalChip workspaceSlug="acme" proposal={proposal({ id: "prop-9", conceptId: "acme/repo/auth" })} />,
    );
    expect(screen.getByTestId("proposal-chip-action")).toHaveTextContent("update");
    expect(screen.getByText("Because the docs drifted.")).toBeInTheDocument();
    expect(screen.getByTestId("proposal-chip-learn-link")).toHaveAttribute("href", "/w/acme/learn?proposal=prop-9");
    // Pending proposals show no status badge
    expect(screen.queryByTestId("proposal-chip-status")).toBeNull();
  });

  it("shows the decided status badge for accepted/rejected proposals", () => {
    render(
      <ConceptProposalChip
        workspaceSlug="acme"
        proposal={proposal({ status: "accepted", conceptId: "acme/repo/auth" })}
      />,
    );
    expect(screen.getByTestId("proposal-chip-status")).toHaveTextContent("accepted");
  });

  it("update: labels with the conceptId and diffs baseDocs → documentation", () => {
    render(
      <ConceptProposalChip
        workspaceSlug="acme"
        proposal={proposal({
          conceptId: "acme/repo/auth",
          baseDocs: "old line",
          documentation: "new line",
        })}
      />,
    );
    expect(screen.getByText("acme/repo/auth")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("proposal-chip-diff-toggle"));
    expect(screen.getByText("old line")).toBeInTheDocument();
    expect(screen.getByText("new line")).toBeInTheDocument();
  });

  it("create: labels with the proposed name and shows the docs as added", () => {
    render(
      <ConceptProposalChip
        workspaceSlug="acme"
        proposal={proposal({
          action: "create",
          name: "Encryption Service",
          documentation: "brand new docs",
        })}
      />,
    );
    expect(screen.getByText("Encryption Service")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("proposal-chip-diff-toggle"));
    expect(screen.getByText("brand new docs")).toBeInTheDocument();
  });

  it("delete: shows the base docs as removed", () => {
    render(
      <ConceptProposalChip
        workspaceSlug="acme"
        proposal={proposal({
          action: "delete",
          conceptId: "acme/repo/janitors",
          baseDocs: "docs being deleted",
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("proposal-chip-diff-toggle"));
    expect(screen.getByText("docs being deleted")).toBeInTheDocument();
  });

  it("merge: labels absorbed → survivor and shows both the survivor diff and the absorbed docs", () => {
    render(
      <ConceptProposalChip
        workspaceSlug="acme"
        proposal={proposal({
          action: "merge",
          conceptId: "acme/repo/janitors",
          mergeIntoConceptId: "acme/repo/swarm",
          baseDocs: "survivor docs",
          documentation: "survivor docs plus janitors",
          absorbedDocs: "absorbed janitor docs",
        })}
      />,
    );
    expect(screen.getByText("acme/repo/janitors → acme/repo/swarm")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("proposal-chip-diff-toggle"));
    expect(screen.getByText("survivor docs plus janitors")).toBeInTheDocument();
    expect(screen.getByText("absorbed janitor docs")).toBeInTheDocument();
    expect(screen.getByText(/Absorbed concept/)).toBeInTheDocument();
  });
});
