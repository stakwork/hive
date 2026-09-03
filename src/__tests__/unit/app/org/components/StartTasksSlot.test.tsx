// @vitest-environment jsdom
/**
 * RTL tests for canvas StartTasksSlot: Start is unchanged (POST assign-all
 * with no body, no bulk auto-merge) and each expanded row PATCHes its own
 * auto-merge / model immediately.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { StartTasksSlot } from "@/app/org/[githubLogin]/_components/StartTasksSlot";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/tasks/PRStatusBadge", () => ({
  PRStatusBadge: ({ url, status }: { url: string; status: string }) => (
    <div data-testid="pr-badge" data-url={url} data-status={status}>
      PR
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <div
      data-testid="select"
      data-value={value}
      data-disabled={String(!!disabled)}
    >
      {React.Children.map(children, (child) =>
        child && React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ onValueChange?: (v: string) => void }>, {
              onValueChange,
            })
          : null,
      )}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-trigger">{children}</div>
  ),
  SelectValue: () => <span>Select</span>,
  SelectContent: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (v: string) => void;
  }) => (
    <div>
      {React.Children.map(children, (child) =>
        child && React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ onValueChange?: (v: string) => void }>, {
              onValueChange,
            })
          : null,
      )}
    </div>
  ),
  SelectItem: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div
      data-testid="select-item"
      data-value={value}
      onClick={() => onValueChange?.(value)}
    >
      {children}
    </div>
  ),
}));

const FEATURE_ID = "feat-1";
const WORKSPACE_SLUG = "hive-ws";

const mockLlmModels = [
  {
    id: "model-1",
    name: "claude-sonnet-4",
    provider: "ANTHROPIC",
    providerLabel: "Claude Sonnet 4",
  },
  {
    id: "model-2",
    name: "gpt-4o",
    provider: "OPENAI",
    providerLabel: "GPT-4o",
  },
];

function makeTask(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "task-todo",
    title: "Implement feature",
    status: "TODO",
    autoMerge: false,
    model: null,
    mode: "live",
    workflowTask: null,
    ...overrides,
  };
}

function makeFeaturePayload(tasks: Record<string, unknown>[]) {
  return {
    data: {
      workspace: { slug: WORKSPACE_SLUG },
      phases: [{ tasks }],
      tasks: [],
    },
  };
}

type FetchOpts = {
  tasks?: Record<string, unknown>[];
  readyCount?: number;
  models?: unknown[];
  patch?: (body: unknown) => {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  };
};

function installFetch(opts: FetchOpts = {}) {
  const {
    tasks = [makeTask()],
    readyCount = 1,
    models = mockLlmModels,
    patch,
  } = opts;
  const feature = makeFeaturePayload(tasks);

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/llm-models")) {
      return { ok: true, status: 200, json: async () => ({ models }) };
    }
    if (url.includes("/tasks/assign-all")) {
      if (method === "POST") {
        return { ok: true, status: 200, json: async () => ({ count: readyCount }) };
      }
      return { ok: true, status: 200, json: async () => ({ readyCount }) };
    }
    if (url.includes("/api/tickets/") && method === "PATCH") {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (patch) return patch(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: body }),
      };
    }
    if (url.includes("/api/features/")) {
      return { ok: true, status: 200, json: async () => feature };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function patchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes("/api/tickets/") &&
      (init as RequestInit | undefined)?.method === "PATCH",
  );
}

function assignAllPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes("/tasks/assign-all") &&
      (init as RequestInit | undefined)?.method === "POST",
  );
}

async function renderExpanded(fetchMock = installFetch()) {
  const user = userEvent.setup();
  render(<StartTasksSlot featureId={FEATURE_ID} />);
  await waitFor(() => {
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });
  await user.click(screen.getByTitle("Show tasks"));
  await waitFor(() => {
    expect(screen.getByTitle("Hide tasks")).toBeInTheDocument();
  });
  return { user, fetchMock };
}

describe("StartTasksSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("does not render a bulk auto-merge control next to Start", async () => {
    installFetch();
    render(<StartTasksSlot featureId={FEATURE_ID} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Start 1/ })).toBeInTheDocument();
    });

    expect(screen.queryByTestId("mini-toggle")).not.toBeInTheDocument();
    expect(screen.queryByText("auto-merge")).not.toBeInTheDocument();
  });

  test("Start POSTs assign-all with no body", async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    render(<StartTasksSlot featureId={FEATURE_ID} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Start 1/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Start 1/ }));

    await waitFor(() => {
      expect(assignAllPosts(fetchMock).length).toBeGreaterThan(0);
    });

    const [, init] = assignAllPosts(fetchMock)[0];
    expect(init).toEqual({ method: "POST" });
    expect(init).not.toHaveProperty("body");
    expect(init).not.toHaveProperty("headers");
  });

  test("TODO row auto-merge toggle PATCHes { autoMerge: true } and does not POST assign-all", async () => {
    const { user, fetchMock } = await renderExpanded();

    const toggle = screen.getByTestId("mini-toggle");
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() => {
      expect(patchCalls(fetchMock).length).toBe(1);
    });

    const [url, init] = patchCalls(fetchMock)[0];
    expect(String(url)).toBe("/api/tickets/task-todo");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      autoMerge: true,
    });
    expect(assignAllPosts(fetchMock)).toHaveLength(0);
  });

  test("TODO row auto-merge toggle PATCHes { autoMerge: false } when turning off", async () => {
    const { user, fetchMock } = await renderExpanded(
      installFetch({ tasks: [makeTask({ autoMerge: true })] }),
    );

    const toggle = screen.getByTestId("mini-toggle");
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(() => {
      expect(patchCalls(fetchMock).length).toBe(1);
    });

    expect(JSON.parse(String((patchCalls(fetchMock)[0][1] as RequestInit).body))).toEqual({
      autoMerge: false,
    });
    expect(assignAllPosts(fetchMock)).toHaveLength(0);
  });

  test("model change PATCHes { model }", async () => {
    const { user, fetchMock } = await renderExpanded();

    await waitFor(() => {
      expect(screen.getAllByTestId("select-item").length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByTestId("select-item")[0]);

    await waitFor(() => {
      expect(patchCalls(fetchMock).length).toBe(1);
    });

    expect(JSON.parse(String((patchCalls(fetchMock)[0][1] as RequestInit).body))).toEqual({
      model: "anthropic/claude-sonnet-4",
    });
  });

  test("row with workflowTask set has no auto-merge switch even if mode is not workflow_editor", async () => {
    await renderExpanded(
      installFetch({
        tasks: [
          makeTask({
            id: "task-wf",
            title: "Workflow ticket",
            mode: "live",
            workflowTask: { id: "wt-1" },
          }),
          makeTask({ id: "task-code", title: "Coding ticket" }),
        ],
      }),
    );

    expect(screen.getByText("Workflow ticket")).toBeInTheDocument();
    expect(screen.getByText("Coding ticket")).toBeInTheDocument();
    expect(screen.getAllByTestId("mini-toggle")).toHaveLength(1);
  });

  test("non-TODO rows have auto-merge and model controls disabled", async () => {
    await renderExpanded(
      installFetch({
        tasks: [
          makeTask({ id: "task-todo", title: "Todo ticket", status: "TODO" }),
          makeTask({
            id: "task-run",
            title: "Running ticket",
            status: "IN_PROGRESS",
          }),
          makeTask({ id: "task-done", title: "Done ticket", status: "DONE" }),
          makeTask({
            id: "task-blocked",
            title: "Blocked ticket",
            status: "BLOCKED",
          }),
        ],
      }),
    );

    const toggles = screen.getAllByTestId("mini-toggle");
    expect(toggles).toHaveLength(4);
    expect(toggles[0]).not.toBeDisabled();
    expect(toggles[1]).toBeDisabled();
    expect(toggles[2]).toBeDisabled();
    expect(toggles[3]).toBeDisabled();

    const selects = screen.getAllByTestId("select");
    expect(selects[0]).toHaveAttribute("data-disabled", "false");
    expect(selects[1]).toHaveAttribute("data-disabled", "true");
    expect(selects[2]).toHaveAttribute("data-disabled", "true");
    expect(selects[3]).toHaveAttribute("data-disabled", "true");
  });

  test("title links use /task for IN_PROGRESS/DONE and /tickets otherwise", async () => {
    await renderExpanded(
      installFetch({
        tasks: [
          makeTask({ id: "task-todo", title: "Todo ticket", status: "TODO" }),
          makeTask({
            id: "task-run",
            title: "Running ticket",
            status: "IN_PROGRESS",
          }),
          makeTask({ id: "task-done", title: "Done ticket", status: "DONE" }),
          makeTask({
            id: "task-blocked",
            title: "Blocked ticket",
            status: "BLOCKED",
          }),
        ],
      }),
    );

    expect(screen.getByText("Todo ticket").closest("a")?.getAttribute("href")).toBe(
      `/w/${WORKSPACE_SLUG}/tickets/task-todo`,
    );
    expect(screen.getByText("Running ticket").closest("a")?.getAttribute("href")).toBe(
      `/w/${WORKSPACE_SLUG}/task/task-run`,
    );
    expect(screen.getByText("Done ticket").closest("a")?.getAttribute("href")).toBe(
      `/w/${WORKSPACE_SLUG}/task/task-done`,
    );
    expect(screen.getByText("Blocked ticket").closest("a")?.getAttribute("href")).toBe(
      `/w/${WORKSPACE_SLUG}/tickets/task-blocked`,
    );
  });

  test("PATCH 409 AUTO_MERGE_NOT_ALLOWED reverts the switch and toasts", async () => {
    const { user } = await renderExpanded(
      installFetch({
        patch: () => ({
          ok: false,
          status: 409,
          json: async () => ({
            error: "Auto-merge is not allowed on this repository",
            code: "AUTO_MERGE_NOT_ALLOWED",
          }),
        }),
      }),
    );

    const toggle = screen.getByTestId("mini-toggle");
    await user.click(toggle);

    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Auto-merge is not allowed on this repository",
    );
  });

  test("PATCH 502 AUTO_MERGE_CHECK_FAILED reverts the switch and toasts", async () => {
    const { user } = await renderExpanded(
      installFetch({
        patch: () => ({
          ok: false,
          status: 502,
          json: async () => ({
            error: "Could not check auto-merge settings",
            code: "AUTO_MERGE_CHECK_FAILED",
          }),
        }),
      }),
    );

    const toggle = screen.getByTestId("mini-toggle");
    await user.click(toggle);

    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Could not check auto-merge settings",
    );
  });

  test("empty GET /api/llm-models renders no model picker", async () => {
    await renderExpanded(installFetch({ models: [] }));

    expect(screen.queryByTestId("select")).not.toBeInTheDocument();
    expect(screen.getByTestId("mini-toggle")).toBeInTheDocument();
  });

  test("in-flight optimistic auto-merge flip survives list refresh", async () => {
    let resolvePatch: ((v: unknown) => void) | undefined;
    const fetchMock = installFetch({
      patch: () =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              resolvePatch = resolve;
            }),
        }) as ReturnType<NonNullable<FetchOpts["patch"]>>,
    });

    const { user } = await renderExpanded(fetchMock);
    const toggle = screen.getByTestId("mini-toggle");
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(toggle).toBeChecked();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      const featureGets = fetchMock.mock.calls.filter(([url, init]) => {
        const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
        return String(url).includes("sortBy=order") && method === "GET";
      });
      expect(featureGets.length).toBeGreaterThan(2);
    });

    expect(toggle).toBeChecked();
    await act(async () => {
      resolvePatch?.({ success: true, data: { autoMerge: true } });
    });
  });
});
