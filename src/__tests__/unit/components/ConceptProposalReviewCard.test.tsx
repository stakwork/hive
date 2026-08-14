import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ConceptProposalReviewCard } from "@/app/w/[slug]/learn/components/ConceptProposalReviewCard";
import type { ConceptProposal } from "@/types/concept-proposals";
import { toast } from "sonner";

const mockUseWorkspaceAccess = vi.fn(() => ({ canWrite: true }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: () => mockUseWorkspaceAccess(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The shared diff renderer is exercised by its own usage in ProposalCard's
// suite; here a stub exposing the diff stats keeps assertions direct.
vi.mock("@/components/diff/UnifiedDiffView", () => ({
  SECTION_LABEL_CLASS: "section-label",
  UnifiedDiffView: ({ diff, emptyText }: any) => (
    <div data-testid="unified-diff" data-added={diff.added} data-removed={diff.removed}>
      {diff.unchanged ? emptyText : `+${diff.added}/-${diff.removed}`}
    </div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, ...props }: any) => (
    <textarea value={value} onChange={onChange} {...props} />
  ),
}));

vi.mock("lucide-react", () => ({
  Check: () => <span data-testid="check-icon" />,
  X: () => <span data-testid="x-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  AlertTriangle: () => <span data-testid="alert-icon" />,
}));

const base = {
  status: "pending" as const,
  rationale: "Concepts drifted from the code.",
  source: "https://github.com/stakwork/hive/pull/201",
  prNumbers: [201],
  createdAt: "2025-08-06T14:30:00.000Z",
  repo: "stakwork/hive",
};

const updateProposal: ConceptProposal = {
  ...base,
  id: "proposal-update-1",
  action: "update",
  conceptId: "stakwork/hive/tasks",
  baseDocs: "Old docs line.",
  documentation: "New docs line.",
};

const createProposal: ConceptProposal = {
  ...base,
  id: "proposal-create-1",
  action: "create",
  name: "Encryption Service",
  documentation: "AES-256-GCM field-level encryption.",
};

const deleteProposal: ConceptProposal = {
  ...base,
  id: "proposal-delete-1",
  action: "delete",
  conceptId: "stakwork/hive/janitors",
  baseDocs: "Janitor docs.",
};

const mergeProposal: ConceptProposal = {
  ...base,
  id: "proposal-merge-1",
  action: "merge",
  conceptId: "stakwork/hive/janitors",
  mergeIntoConceptId: "stakwork/hive/swarm",
  baseDocs: "Swarm docs.",
  absorbedDocs: "Janitor docs.",
  documentation: "Swarm docs plus janitors.",
};

function renderCard(
  proposal: ConceptProposal,
  overrides: Partial<React.ComponentProps<typeof ConceptProposalReviewCard>> = {},
) {
  const onDecided = vi.fn();
  const onTerminal = vi.fn();
  render(
    <ConceptProposalReviewCard
      proposal={proposal}
      workspaceSlug="test-ws"
      onDecided={onDecided}
      onTerminal={onTerminal}
      {...overrides}
    />,
  );
  return { onDecided, onTerminal };
}

function mockFetchResponse(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("ConceptProposalReviewCard — per-action rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspaceAccess.mockReturnValue({ canWrite: true });
    global.fetch = mockFetchResponse(200, {});
  });

  it("update: renders a diff labeled with the concept id, plus metadata", () => {
    renderCard(updateProposal);
    const diffSection = screen.getByTestId("proposal-diff");
    expect(diffSection.textContent).toContain("stakwork/hive/tasks");
    expect(diffSection.querySelector('[data-testid="unified-diff"]')).toBeTruthy();
    expect(screen.getByText("Concepts drifted from the code.")).toBeTruthy();
    expect(screen.getByTestId("proposal-pr-numbers").textContent).toContain("#201");
    expect(screen.getByTestId("proposal-action-badge").textContent).toBe("Update");
  });

  it("create: shows name and proposed docs verbatim, no diff", () => {
    renderCard(createProposal);
    expect(screen.getByText("Encryption Service")).toBeTruthy();
    expect(screen.getByTestId("proposal-create-docs").textContent).toBe(
      "AES-256-GCM field-level encryption.",
    );
    expect(screen.queryByTestId("proposal-diff")).toBeNull();
  });

  it("delete: shows baseDocs as fully removed", () => {
    renderCard(deleteProposal);
    const diff = screen
      .getByTestId("proposal-diff")
      .querySelector('[data-testid="unified-diff"]');
    // The empty "after" text still parses as one blank line, so added is 1.
    expect(diff?.getAttribute("data-removed")).toBe("1");
    expect(diff?.textContent).toContain("-1");
  });

  it("merge: shows the survivor diff and the absorbed docs separately", () => {
    renderCard(mergeProposal);
    expect(screen.getByTestId("proposal-diff").textContent).toContain(
      "stakwork/hive/swarm",
    );
    const absorbed = screen.getByTestId("proposal-absorbed-docs");
    expect(absorbed.textContent).toContain("stakwork/hive/janitors");
    const absorbedDiff = absorbed.querySelector('[data-testid="unified-diff"]');
    expect(absorbedDiff?.getAttribute("data-removed")).toBe("1");
  });

  it("hides decision buttons below DEVELOPER role", () => {
    mockUseWorkspaceAccess.mockReturnValue({ canWrite: false });
    renderCard(updateProposal);
    expect(screen.queryByTestId("proposal-accept-button")).toBeNull();
    expect(screen.queryByTestId("proposal-reject-button")).toBeNull();
    expect(screen.getByTestId("proposal-readonly-note")).toBeTruthy();
  });
});

describe("ConceptProposalReviewCard — decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspaceAccess.mockReturnValue({ canWrite: true });
  });

  it("accept POSTs to the accept proxy with the workspace param", async () => {
    global.fetch = mockFetchResponse(200, { status: "success", proposal: updateProposal });
    const { onDecided } = renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-accept-button"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/learnings/concepts/proposals/proposal-update-1/accept?workspace=test-ws",
        expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
      );
      expect(onDecided).toHaveBeenCalledWith({
        outcome: "accepted",
        createdConceptId: undefined,
      });
    });
  });

  it("accepting a create proposal passes createdConceptId through", async () => {
    global.fetch = mockFetchResponse(200, {
      status: "success",
      proposal: { ...createProposal, createdConceptId: "stakwork/hive/encryption-service" },
    });
    const { onDecided } = renderCard(createProposal);
    fireEvent.click(screen.getByTestId("proposal-accept-button"));

    await waitFor(() => {
      expect(onDecided).toHaveBeenCalledWith({
        outcome: "accepted",
        createdConceptId: "stakwork/hive/encryption-service",
      });
    });
  });

  it("reject sends the optional reason and reports the outcome", async () => {
    global.fetch = mockFetchResponse(200, { status: "success" });
    const { onDecided } = renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-reject-button"));
    fireEvent.change(screen.getByTestId("proposal-reject-reason"), {
      target: { value: "Outdated." },
    });
    fireEvent.click(screen.getByTestId("proposal-reject-confirm"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/learnings/concepts/proposals/proposal-update-1/reject?workspace=test-ws",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "Outdated." }),
        }),
      );
      expect(onDecided).toHaveBeenCalledWith({
        outcome: "rejected",
        createdConceptId: undefined,
      });
    });
  });

  it("reject without a reason sends an empty body", async () => {
    global.fetch = mockFetchResponse(200, { status: "success" });
    renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-reject-button"));
    fireEvent.click(screen.getByTestId("proposal-reject-confirm"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/reject?workspace=test-ws"),
        expect.objectContaining({ body: JSON.stringify({}) }),
      );
    });
  });

  it("surfaces upstream errors as a toast without deciding", async () => {
    global.fetch = mockFetchResponse(502, { error: "Upstream exploded" });
    const { onDecided, onTerminal } = renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-accept-button"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Upstream exploded");
    });
    expect(onDecided).not.toHaveBeenCalled();
    expect(onTerminal).not.toHaveBeenCalled();
  });
});

describe("ConceptProposalReviewCard — stale_base flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspaceAccess.mockReturnValue({ canWrite: true });
  });

  async function triggerStale() {
    global.fetch = mockFetchResponse(409, {
      error: "drifted",
      code: "stale_base",
      conceptId: "stakwork/hive/tasks",
    });
    const callbacks = renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-accept-button"));
    await waitFor(() => {
      expect(screen.getByTestId("proposal-stale-banner")).toBeTruthy();
    });
    return callbacks;
  }

  it("shows the re-review banner and swaps Accept for force-accept", async () => {
    const { onDecided } = await triggerStale();
    expect(screen.queryByTestId("proposal-accept-button")).toBeNull();
    expect(screen.getByTestId("proposal-force-accept-button")).toBeTruthy();
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("re-fetch loads the concept's current docs and shows a fresh diff", async () => {
    await triggerStale();
    global.fetch = mockFetchResponse(200, {
      concept: { documentation: "Docs as they are now." },
    });
    fireEvent.click(screen.getByTestId("proposal-stale-refetch"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/learnings/concepts/stakwork%2Fhive%2Ftasks?workspace=test-ws",
      );
      expect(screen.getByTestId("proposal-current-diff")).toBeTruthy();
    });
  });

  it("force-accept re-calls accept with force: true", async () => {
    const { onDecided } = await triggerStale();
    global.fetch = mockFetchResponse(200, { status: "success", proposal: updateProposal });
    fireEvent.click(screen.getByTestId("proposal-force-accept-button"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/learnings/concepts/proposals/proposal-update-1/accept?workspace=test-ws",
        expect.objectContaining({ body: JSON.stringify({ force: true }) }),
      );
      expect(onDecided).toHaveBeenCalledWith({
        outcome: "accepted",
        createdConceptId: undefined,
      });
    });
  });
});

describe("ConceptProposalReviewCard — terminal states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspaceAccess.mockReturnValue({ canWrite: true });
  });

  it("409 already-decided shows a terminal banner, no force-accept", async () => {
    global.fetch = mockFetchResponse(409, {
      error: "already decided",
      status: "accepted",
    });
    const { onTerminal } = renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-accept-button"));

    await waitFor(() => {
      expect(screen.getByTestId("proposal-terminal-state").textContent).toContain(
        "already accepted",
      );
      expect(onTerminal).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("proposal-force-accept-button")).toBeNull();
    expect(screen.queryByTestId("proposal-accept-button")).toBeNull();
  });

  it("404 shows the gone terminal state and refreshes the list", async () => {
    global.fetch = mockFetchResponse(404, { error: "not found" });
    const { onTerminal, onDecided } = renderCard(updateProposal);
    fireEvent.click(screen.getByTestId("proposal-accept-button"));

    await waitFor(() => {
      expect(screen.getByTestId("proposal-terminal-state").textContent).toContain(
        "no longer exists",
      );
      expect(onTerminal).toHaveBeenCalled();
    });
    expect(onDecided).not.toHaveBeenCalled();
  });
});
