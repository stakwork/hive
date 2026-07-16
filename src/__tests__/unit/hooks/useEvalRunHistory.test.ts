import { renderHook, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockWorkspace = {
  id: "ws-123",
  slug: "openlaw",
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({ workspace: mockWorkspace })),
}));

vi.mock("@/lib/harvey-lab/eval-normalizers", () => ({
  normalizeOutput: vi.fn((o: unknown) => o),
  triggerHasIdentity: vi.fn(() => true),
}));

global.fetch = vi.fn();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EVAL_TRIGGER_REF = "trigger-ref-001";
const PROJECT_ID = 42;
const CREATED_AT = "2025-01-10T12:00:00.000Z";

const MOCK_REQUIREMENT = {
  ref_id: "req-001",
  properties: { id: "antitrust/task-1" },
};

const MOCK_TRIGGER = {
  ref_id: EVAL_TRIGGER_REF,
  properties: { name: "trigger-001" },
  outputs: [],
};

const MOCK_STAKWORK_RUN = {
  id: "run-stakwork-001",
  projectId: PROJECT_ID,
  result: JSON.stringify({ evalTriggerRef: EVAL_TRIGGER_REF, taskSlug: "antitrust/task-1" }),
  createdAt: CREATED_AT,
};

/**
 * Set up fetch mock for the 3-step flow:
 *  call 0 → requirements list
 *  call 1 → triggers (Promise.all[0])
 *  call 2 → stakwork runs (Promise.all[1])
 */
function setupFetches(responses: Array<{ ok: boolean; data: unknown }>) {
  let callIndex = 0;
  vi.mocked(global.fetch).mockImplementation(() => {
    const r = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve({ ok: r.ok, json: async () => r.data } as Response);
  });
}

function defaultResponses(
  runOverrides: unknown[] = [MOCK_STAKWORK_RUN],
): Array<{ ok: boolean; data: unknown }> {
  return [
    { ok: true, data: { data: { nodes: [MOCK_REQUIREMENT] } } },
    { ok: true, data: { data: { nodes: [MOCK_TRIGGER] } } },
    { ok: true, data: { runs: runOverrides } },
  ];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useEvalRunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends includeResult=true to the Stakwork runs fetch", async () => {
    setupFetches(defaultResponses());

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    // Wait until all 3 fetches have fired (requirements + triggers + runs)
    await waitFor(() => {
      expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    // Find the call to /api/stakwork/runs
    const runsCall = vi.mocked(global.fetch).mock.calls.find(([url]) =>
      String(url).includes("/api/stakwork/runs"),
    );
    expect(runsCall).toBeDefined();
    const runsUrl = String(runsCall![0]);
    expect(runsUrl).toContain("includeResult=true");
    expect(runsUrl).toContain("type=LEGAL_BENCHMARK_RUNNER");

    // Suppress unused variable warning
    expect(result.current).toBeDefined();
  });

  it("reads runs from runsData.runs (not runsData.data) — correct response key", async () => {
    setupFetches(defaultResponses());

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    // Wait for Phase 2 to complete and produce history entries
    await waitFor(() => {
      expect(result.current.history.length).toBeGreaterThan(0);
    });

    // The trigger→run join should produce one matched entry (not empty due to wrong key)
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].triggerId).toBe(EVAL_TRIGGER_REF);
    expect(result.current.history[0].createdAt).toBe(CREATED_AT);
    expect(result.current.history[0].projectId).toBe(PROJECT_ID);
  });

  it("trigger→run join: matches trigger ref_id to run.result.evalTriggerRef for multiple entries", async () => {
    const anotherTrigger = {
      ref_id: "trigger-ref-002",
      properties: { name: "trigger-002" },
      outputs: [],
    };
    const anotherRun = {
      id: "run-002",
      projectId: 99,
      result: JSON.stringify({ evalTriggerRef: "trigger-ref-002", taskSlug: "antitrust/task-1" }),
      createdAt: "2025-01-11T12:00:00.000Z",
    };

    setupFetches([
      { ok: true, data: { data: { nodes: [MOCK_REQUIREMENT] } } },
      { ok: true, data: { data: { nodes: [MOCK_TRIGGER, anotherTrigger] } } },
      { ok: true, data: { runs: [MOCK_STAKWORK_RUN, anotherRun] } },
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    await waitFor(() => {
      expect(result.current.history.length).toBe(2);
    });

    const entry1 = result.current.history.find((e) => e.triggerId === EVAL_TRIGGER_REF);
    expect(entry1?.projectId).toBe(PROJECT_ID);
    expect(entry1?.createdAt).toBe(CREATED_AT);

    const entry2 = result.current.history.find((e) => e.triggerId === "trigger-ref-002");
    expect(entry2?.projectId).toBe(99);
  });

  it("trigger with no matching run has null createdAt and null projectId", async () => {
    setupFetches([
      { ok: true, data: { data: { nodes: [MOCK_REQUIREMENT] } } },
      { ok: true, data: { data: { nodes: [MOCK_TRIGGER] } } },
      { ok: true, data: { runs: [] } }, // No matching runs
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    // Wait for all 3 fetches to complete
    await waitFor(() => {
      expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    // Wait for loading to settle
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].createdAt).toBeNull();
    expect(result.current.history[0].projectId).toBeNull();
  });

  it("trigger→run join is empty when response uses wrong key `data` instead of `runs` (regression guard)", async () => {
    // Simulates the OLD buggy response shape — ensure we don't re-introduce `runsData?.data`
    setupFetches([
      { ok: true, data: { data: { nodes: [MOCK_REQUIREMENT] } } },
      { ok: true, data: { data: { nodes: [MOCK_TRIGGER] } } },
      // Response uses wrong key `data` — should NOT be read by the fixed hook
      { ok: true, data: { data: [MOCK_STAKWORK_RUN] } },
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    await waitFor(() => {
      expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // With the wrong key, join finds no run — entry has null createdAt/projectId
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].createdAt).toBeNull();
    expect(result.current.history[0].projectId).toBeNull();
  });

  it("does nothing when taskSlug is empty (no fetches triggered)", () => {
    const { result } = renderHook(() => useEvalRunHistory(""));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.history).toHaveLength(0);
  });
});
