// @vitest-environment jsdom
/**
 * Unit tests for the repo-context selector on ProposalCard (feature kind).
 *
 * Covers:
 * - Defaults to all repos selected once the fetch resolves.
 * - Forwards a narrowed selectedRepositoryIds subset on approve.
 * - Hides the selector (and forwards nothing) when proposal.meta is absent.
 * - Hides the selector (and forwards nothing) when the fetch returns non-2xx/404.
 * - Hides the selector (and forwards nothing) when the repo list is empty.
 * - Zero-selection guard: approve button is disabled when selector is live but
 *   nothing is selected; never forwards an empty array.
 * - Approval-before-fetch race: if approval fires before the fetch resolves,
 *   selectedRepositoryIds is NOT forwarded (all-repos default).
 * - localStorage persistence: selection is initialised from the shared
 *   per-workspace plan-repo preference, stale ids are dropped (fallback to
 *   all), and approving persists the current selection.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { ProposalCard } from "@/app/org/[githubLogin]/_components/ProposalCard";
import type { ProposalOutput } from "@/lib/proposals/types";
import { getPlanRepoPreference, setPlanRepoPreference } from "@/lib/ai/models";

// ── Mutable store state ───────────────────────────────────────────────────────

let mockStoreState: any = {
  activeConversationId: "conv-1",
  conversations: {
    "conv-1": {
      messages: [],
      context: { currentCanvasRef: "root" },
    },
  },
  canvasViewport: null,
};

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  // The component calls useCanvasChatStore(selector) as a hook AND
  // useCanvasChatStore.getState() imperatively inside handleApprove.
  // Both must work with the same mutable state object.
  const useCanvasChatStore = (selector: (s: any) => any) =>
    selector(mockStoreState);
  useCanvasChatStore.getState = () => mockStoreState;
  return { useCanvasChatStore };
});

// ── sendMessage spy — captured per test ───────────────────────────────────────

let mockSendMessage: ReturnType<typeof vi.fn>;

vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({
  useSendCanvasChatMessage: () => mockSendMessage,
}));

// ── UI component mocks ────────────────────────────────────────────────────────

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="dialog-header" className={className ?? ""}>{children}</div>
  ),
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 data-slot="dialog-title" className={className ?? ""}>{children}</h2>
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-slot="scroll-area" className={className ?? ""}>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

// DropdownMenu: render content inline so checkbox items are always in the DOM.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <div>{children}</div>),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-label">{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
    onSelect,
  }: {
    children: React.ReactNode;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    onSelect?: (e: Event) => void;
  }) => (
    <label data-testid="repo-checkbox-item">
      <input
        type="checkbox"
        checked={checked ?? false}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        data-testid="repo-checkbox"
      />
      {children}
    </label>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <span>{children}</span>),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    style,
    type,
    variant: _v,
    size: _s,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      style={style}
      type={type}
      data-testid="repo-selector-button"
      {...rest}
    >
      {children}
    </button>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFeatureProposal(
  overrides: Partial<Extract<ProposalOutput, { kind: "feature" }>> = {},
): Extract<ProposalOutput, { kind: "feature" }> {
  return {
    kind: "feature",
    proposalId: "prop-feat-1",
    payload: {
      title: "New Feature",
      workspaceId: "ws-123",
      initialMessage: "Build it",
      ...((overrides as any).payload ?? {}),
    },
    ...overrides,
  } as Extract<ProposalOutput, { kind: "feature" }>;
}

function makeFetchOk(repos: Array<{ id: string; name: string }>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ workspace: { repositories: repos } }),
  } as unknown as Response);
}

function makeFetchError(status = 404) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response);
}

function makeFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error("Network error"));
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockSendMessage = vi.fn().mockResolvedValue(undefined);
  mockStoreState = {
    activeConversationId: "conv-1",
    conversations: {
      "conv-1": {
        messages: [],
        context: { currentCanvasRef: "root" },
      },
    },
    canvasViewport: null,
  };
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProposalCard — repo selector: default all-selected", () => {
  it("renders a checkbox for each repo and all are checked by default", async () => {
    const repos = [
      { id: "repo-1", name: "alpha" },
      { id: "repo-2", name: "beta" },
    ];
    global.fetch = makeFetchOk(repos);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-1" githubLogin="myorg" />,
    );

    // Wait for the async fetch to resolve and the selector to appear
    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(2);
    });

    const checkboxes = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    expect(checkboxes.every((cb) => cb.checked)).toBe(true);
  });
});

describe("ProposalCard — repo selector: narrowed subset forwarded", () => {
  it("includes selectedRepositoryIds in approval intent when a subset is selected", async () => {
    const repos = [
      { id: "repo-1", name: "alpha" },
      { id: "repo-2", name: "beta" },
      { id: "repo-3", name: "gamma" },
    ];
    global.fetch = makeFetchOk(repos);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-2" githubLogin="myorg" />,
    );

    // Wait for checkboxes to appear
    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(3);
    });

    // Uncheck repo-2 (the second checkbox)
    const checkboxes = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    await act(async () => {
      fireEvent.click(checkboxes[1]); // uncheck "beta"
    });

    // Click approve
    await act(async () => {
      fireEvent.click(screen.getByTitle("Approve"));
    });

    expect(mockSendMessage).toHaveBeenCalledOnce();
    const call = mockSendMessage.mock.calls[0][0];
    expect(call.approval.payload.selectedRepositoryIds).toEqual(
      expect.arrayContaining(["repo-1", "repo-3"]),
    );
    expect(call.approval.payload.selectedRepositoryIds).toHaveLength(2);
    expect(call.approval.payload.selectedRepositoryIds).not.toContain("repo-2");
  });
});

describe("ProposalCard — repo selector: hidden when meta is absent", () => {
  it("does not render repo checkboxes when proposal has no meta", async () => {
    // No fetch should be made (no workspaceSlug to fetch from)
    global.fetch = vi.fn();

    const proposal = makeFeatureProposal({
      // No meta field
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-3" githubLogin="myorg" />,
    );

    // Give a tick for any potential async effects
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.queryByTestId("repo-checkbox")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not include selectedRepositoryIds in payload when meta is absent", async () => {
    global.fetch = vi.fn();

    const proposal = makeFeatureProposal();

    render(
      <ProposalCard proposal={proposal} messageId="msg-3b" githubLogin="myorg" />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle("Approve"));
    });

    const call = mockSendMessage.mock.calls[0][0];
    expect(call.approval.payload?.selectedRepositoryIds).toBeUndefined();
  });
});

describe("ProposalCard — repo selector: hidden on non-2xx/404 fetch", () => {
  it("does not render repo checkboxes when fetch returns 404", async () => {
    global.fetch = makeFetchError(404);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "private-workspace", workspaceName: "Private" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-4" githubLogin="myorg" />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(screen.queryByTestId("repo-checkbox")).toBeNull();
  });

  it("does not render repo checkboxes when fetch rejects (network error)", async () => {
    global.fetch = makeFetchNetworkError();

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-5" githubLogin="myorg" />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(screen.queryByTestId("repo-checkbox")).toBeNull();
  });

  it("does not include selectedRepositoryIds when fetch returns non-2xx", async () => {
    global.fetch = makeFetchError(403);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-5b" githubLogin="myorg" />,
    );

    // Wait for fetch to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Approve"));
    });

    const call = mockSendMessage.mock.calls[0][0];
    expect(call.approval.payload?.selectedRepositoryIds).toBeUndefined();
  });
});

describe("ProposalCard — repo selector: hidden when repo list is empty", () => {
  it("does not render repo checkboxes when workspace has no repos", async () => {
    global.fetch = makeFetchOk([]); // empty repo list

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "empty-workspace", workspaceName: "Empty" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-6" githubLogin="myorg" />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(screen.queryByTestId("repo-checkbox")).toBeNull();
  });
});

describe("ProposalCard — repo selector: zero-selection guard", () => {
  it("approve button is disabled when selector is live but nothing is selected", async () => {
    const repos = [
      { id: "repo-1", name: "alpha" },
      { id: "repo-2", name: "beta" },
    ];
    global.fetch = makeFetchOk(repos);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-7" githubLogin="myorg" />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(2);
    });

    // Uncheck both
    const checkboxes = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    await act(async () => {
      fireEvent.click(checkboxes[0]); // uncheck alpha
    });
    await act(async () => {
      fireEvent.click(checkboxes[1]); // uncheck beta
    });

    const approveBtn = screen.getByTitle("Select at least one repository") as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
  });

  it("never calls sendMessage with an empty selectedRepositoryIds array", async () => {
    const repos = [{ id: "repo-1", name: "alpha" }];
    global.fetch = makeFetchOk(repos);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-8" githubLogin="myorg" />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(1);
    });

    // Uncheck the only repo — approve should be disabled
    const [checkbox] = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    await act(async () => {
      fireEvent.click(checkbox);
    });

    // The button is disabled — clicking it should not call sendMessage
    const btn = screen.queryByTitle("Select at least one repository") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);

    // Attempt to fire click anyway — should still not trigger sendMessage
    fireEvent.click(btn!);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("ProposalCard — repo selector: approval-before-fetch race", () => {
  it("forwards nothing (no selectedRepositoryIds) when approval fires before fetch resolves", async () => {
    // Make the fetch never resolve during the approve click
    let resolveFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = vi.fn().mockReturnValue(pendingFetch);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-9" githubLogin="myorg" />,
    );

    // At this point fetch is pending — no selector rendered
    expect(screen.queryByTestId("repo-checkbox")).toBeNull();

    // Approve immediately (before fetch resolves)
    await act(async () => {
      fireEvent.click(screen.getByTitle("Approve"));
    });

    expect(mockSendMessage).toHaveBeenCalledOnce();
    const call = mockSendMessage.mock.calls[0][0];
    // Must NOT include selectedRepositoryIds
    expect(call.approval.payload?.selectedRepositoryIds).toBeUndefined();

    // Clean up the pending promise to avoid open handles
    resolveFetch({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response);
  });
});

describe("ProposalCard — repo selector: localStorage persistence (shared with plan page)", () => {
  it("initialises selection from the stored per-workspace preference", async () => {
    const repos = [
      { id: "repo-1", name: "alpha" },
      { id: "repo-2", name: "beta" },
      { id: "repo-3", name: "gamma" },
    ];
    global.fetch = makeFetchOk(repos);
    setPlanRepoPreference("my-workspace", ["repo-2"]);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-10" githubLogin="myorg" />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(3);
    });

    const checkboxes = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    expect(checkboxes.map((cb) => cb.checked)).toEqual([false, true, false]);
  });

  it("falls back to all selected when every stored id is stale", async () => {
    const repos = [
      { id: "repo-1", name: "alpha" },
      { id: "repo-2", name: "beta" },
    ];
    global.fetch = makeFetchOk(repos);
    setPlanRepoPreference("my-workspace", ["deleted-repo"]);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-11" githubLogin="myorg" />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(2);
    });

    const checkboxes = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    expect(checkboxes.every((cb) => cb.checked)).toBe(true);
  });

  it("persists the current selection on approve", async () => {
    const repos = [
      { id: "repo-1", name: "alpha" },
      { id: "repo-2", name: "beta" },
    ];
    global.fetch = makeFetchOk(repos);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-12" githubLogin="myorg" />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("repo-checkbox")).toHaveLength(2);
    });

    const checkboxes = screen.getAllByTestId("repo-checkbox") as HTMLInputElement[];
    await act(async () => {
      fireEvent.click(checkboxes[1]); // uncheck "beta"
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Approve"));
    });

    expect(getPlanRepoPreference("my-workspace")).toEqual(["repo-1"]);
  });

  it("does not write a preference when approval fires before the fetch resolves", async () => {
    let resolveFetch!: (value: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = vi.fn().mockReturnValue(pendingFetch);

    const proposal = makeFeatureProposal({
      meta: { workspaceSlug: "my-workspace", workspaceName: "My Workspace" },
    });

    render(
      <ProposalCard proposal={proposal} messageId="msg-13" githubLogin="myorg" />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle("Approve"));
    });

    expect(getPlanRepoPreference("my-workspace")).toBeNull();

    resolveFetch({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response);
  });
});
