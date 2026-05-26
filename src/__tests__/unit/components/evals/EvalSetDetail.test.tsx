/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

globalThis.React = React;

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-ws" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/evals/CreateRequirementModal", () => ({
  CreateRequirementModal: () => null,
}));

vi.mock("@/components/evals/LinkRunModal", () => ({
  LinkRunModal: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => <span>←</span>,
  Link2: () => <span>🔗</span>,
  Plus: () => <span>+</span>,
}));

import { EvalSetDetail } from "@/components/evals/EvalSetDetail";

const EVAL_SET = {
  ref_id: "eval-set-1",
  node_type: "EvalSet",
  properties: { name: "My Eval Set", description: "Test suite" },
};

const MOCK_REQUIREMENTS = [
  {
    ref_id: "req-1",
    node_type: "EvalRequirement",
    properties: {
      name: "Req Alpha",
      description: "First requirement",
      prompt_snippet: "When asked to...",
      positive_cases: ["Does A", "Does B"],
      negative_cases: ["Does not C"],
      order: 0,
    },
  },
  {
    ref_id: "req-2",
    node_type: "EvalRequirement",
    properties: {
      name: "Req Beta",
      description: "Second requirement",
      prompt_snippet: "When instructed to...",
      positive_cases: ["Does X"],
      negative_cases: ["Does not Y"],
      order: 1,
    },
  },
];

describe("EvalSetDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches from the correct requirements endpoint (not the list-all-evals endpoint)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    });
    global.fetch = fetchMock as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl: string = fetchMock.mock.calls[0][0];
    // Must call the requirements endpoint
    expect(calledUrl).toBe("/api/workspaces/test-ws/evals/eval-set-1/requirements");
    // Must NOT call the list-all endpoint
    expect(calledUrl).not.toContain("?evalSetId=");
  });

  it("renders skeleton while loading", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders empty state when no requirements are returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/No requirements yet/)).toBeTruthy();
    });
  });

  it("renders requirement rows when requirements are returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("requirement-row")).toHaveLength(2);
    });

    expect(screen.getByText("Req Alpha")).toBeTruthy();
    expect(screen.getByText("Req Beta")).toBeTruthy();
  });

  it("renders requirements sorted by order property", async () => {
    // Return in reverse order — component should sort by order
    const reversedNodes = [...MOCK_REQUIREMENTS].reverse();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: reversedNodes, total: 2 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("requirement-row")).toHaveLength(2);
    });

    const rows = screen.getAllByTestId("requirement-row");
    expect(rows[0].textContent).toContain("Req Alpha");
    expect(rows[1].textContent).toContain("Req Beta");
  });

  it("shows eval set name in header", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("My Eval Set")).toBeTruthy();
    });
  });
});
