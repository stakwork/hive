// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock shadcn/ui Select — same pattern as OrgInitiatives.test.tsx
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      data-testid="assignee-select"
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

// ---------------------------------------------------------------------------
// Mock lucide-react icons used in NodeDetail
// ---------------------------------------------------------------------------
vi.mock("lucide-react", () => ({
  ArrowUpRight: () => <span data-testid="arrow-up-right" />,
  Loader2: () => <span data-testid="loader2" />,
  MessageSquare: () => <span data-testid="message-square" />,
}));

// ---------------------------------------------------------------------------
// Mock ReactMarkdown (not needed for milestone case but imported at top)
// ---------------------------------------------------------------------------
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock sub-components that LiveNodeBody renders but aren't relevant here
// ---------------------------------------------------------------------------
vi.mock(
  "@/app/org/[githubLogin]/_state/canvasChatStore",
  () => ({
    useCanvasChatStore: vi.fn(() => ({})),
  }),
);

vi.mock("@/app/org/[githubLogin]/_components/FeaturePlanChat", () => ({
  FeaturePlanChat: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/TaskChat", () => ({
  TaskChat: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/ResearchViewer", () => ({
  ResearchViewer: () => null,
}));

// ---------------------------------------------------------------------------
// Now import the component under test
// ---------------------------------------------------------------------------
// MilestoneExtras is not exported directly; we'll import and render
// LiveNodeBody with a mocked fetch that returns a milestone detail, OR
// we can directly render via a wrapper. Since MilestoneExtras is a
// module-private function we test it via LiveNodeBody.
import { LiveNodeBody } from "@/app/org/[githubLogin]/_components/NodeDetail";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEMBERS = [
  { id: "user-1", name: "Alice", githubUsername: "alice", image: null, workspaceDescriptions: [] },
  { id: "user-2", name: null, githubUsername: "bob", image: null, workspaceDescriptions: [] },
];

function makeMilestoneDetail(assigneeId?: string) {
  return {
    kind: "milestone",
    id: `milestone:ms-123`,
    name: "Sprint Alpha",
    description: null,
    extras: {
      status: "IN_PROGRESS",
      dueDate: null,
      completedAt: null,
      featureCount: 3,
      assignee: assigneeId
        ? { id: assigneeId, name: assigneeId === "user-1" ? "Alice" : null }
        : null,
      initiative: { id: "init-456", name: "Q3 Roadmap" },
    },
  };
}

function setupFetch(
  milestoneDetail: ReturnType<typeof makeMilestoneDetail>,
  membersData = MEMBERS,
) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if ((url as string).includes("/canvas/node/")) {
      return Promise.resolve({
        ok: true,
        json: async () => milestoneDetail,
      });
    }
    if ((url as string).includes("/members")) {
      return Promise.resolve({
        ok: true,
        json: async () => membersData,
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NodeDetail milestone — assignee picker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Unassigned' option and members after fetch", async () => {
    setupFetch(makeMilestoneDetail());
    render(
      <LiveNodeBody
        nodeId="milestone:ms-123"
        githubLogin="testorg"
      />,
    );

    // Wait for both the node detail AND the members fetch to complete
    await waitFor(() => {
      const select = screen.getByTestId("assignee-select") as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll("option")).map(
        (o) => o.value,
      );
      expect(options).toContain("__none__");
      expect(options).toContain("user-1");
      expect(options).toContain("user-2");
    });
  });

  it("pre-selects 'Unassigned' when no assignee", async () => {
    setupFetch(makeMilestoneDetail());
    render(
      <LiveNodeBody nodeId="milestone:ms-123" githubLogin="testorg" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("assignee-select")).toBeInTheDocument(),
    );

    const select = screen.getByTestId("assignee-select") as HTMLSelectElement;
    expect(select.value).toBe("__none__");
  });

  it("pre-selects the existing assignee when one is set", async () => {
    setupFetch(makeMilestoneDetail("user-1"));
    render(
      <LiveNodeBody nodeId="milestone:ms-123" githubLogin="testorg" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("assignee-select")).toBeInTheDocument(),
    );

    const select = screen.getByTestId("assignee-select") as HTMLSelectElement;
    expect(select.value).toBe("user-1");
  });

  it("PATCHes assigneeId on selection change", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((url as string).includes("/canvas/node/")) {
        return Promise.resolve({ ok: true, json: async () => makeMilestoneDetail() });
      }
      if ((url as string).includes("/members")) {
        return Promise.resolve({ ok: true, json: async () => MEMBERS });
      }
      if (opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = mockFetch;

    render(
      <LiveNodeBody nodeId="milestone:ms-123" githubLogin="testorg" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("assignee-select")).toBeInTheDocument(),
    );

    const select = screen.getByTestId("assignee-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "user-1" } });

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        ([, opts]) => opts?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const [url, opts] = patchCall!;
      expect(url).toContain("/initiatives/init-456/milestones/ms-123");
      expect(JSON.parse(opts.body as string)).toEqual({ assigneeId: "user-1" });
    });
  });

  it("PATCHes assigneeId: null when '__none__' selected", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((url as string).includes("/canvas/node/")) {
        return Promise.resolve({ ok: true, json: async () => makeMilestoneDetail("user-1") });
      }
      if ((url as string).includes("/members")) {
        return Promise.resolve({ ok: true, json: async () => MEMBERS });
      }
      if (opts?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = mockFetch;

    render(
      <LiveNodeBody nodeId="milestone:ms-123" githubLogin="testorg" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("assignee-select")).toBeInTheDocument(),
    );

    const select = screen.getByTestId("assignee-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "__none__" } });

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        ([, opts]) => opts?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const [, opts] = patchCall!;
      expect(JSON.parse(opts.body as string)).toEqual({ assigneeId: null });
    });
  });

  it("reverts optimistic state on PATCH failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let patchCallCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if ((url as string).includes("/canvas/node/")) {
        return Promise.resolve({ ok: true, json: async () => makeMilestoneDetail() });
      }
      if ((url as string).includes("/members")) {
        return Promise.resolve({ ok: true, json: async () => MEMBERS });
      }
      if (opts?.method === "PATCH") {
        patchCallCount++;
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => "Server error",
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = mockFetch;

    render(
      <LiveNodeBody nodeId="milestone:ms-123" githubLogin="testorg" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("assignee-select")).toBeInTheDocument(),
    );

    const select = screen.getByTestId("assignee-select") as HTMLSelectElement;

    // Optimistically change to user-1
    fireEvent.change(select, { target: { value: "user-1" } });

    // After PATCH fails, should revert to __none__
    await waitFor(() => {
      expect(patchCallCount).toBe(1);
      expect(select.value).toBe("__none__");
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[NodeDetail]"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("shows member name in option when available", async () => {
    setupFetch(makeMilestoneDetail());
    render(
      <LiveNodeBody nodeId="milestone:ms-123" githubLogin="testorg" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("assignee-select")).toBeInTheDocument(),
    );

    // Alice has a name
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // bob has no name — falls back to githubUsername
    expect(screen.getByText("bob")).toBeInTheDocument();
  });
});
