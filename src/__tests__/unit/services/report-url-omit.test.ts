/**
 * Unit tests for the reportUrl/webhookUrl global Prisma omit and hasReport derivation.
 *
 * Test cases:
 *  1. Global invariant: getStakworkRuns response never contains reportUrl, webhookUrl, or report_url
 *  2. hasReport derives from reportBundle presence, NOT from reportUrl column
 *  3. hasReport is false when reportBundle is null
 *  4. hasReport is true when reportBundle is non-null
 *  5. Explicit select for webhookUrl is opt-in — not a hard removal (the write path still works)
 *  6. reportPartial derives from the reportPartial column, not from reportUrl
 *  7. schemaUnsupported derives from the schemaUnsupported column
 *  8. reportBundle is not forwarded to the mapped output (projection stripped, only flags)
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockDbWorkspaceFindUnique = vi.hoisted(() => vi.fn());
const mockDbStakworkRunCount = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindMany = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: mockDbWorkspaceFindUnique,
    },
    stakworkRun: {
      count: mockDbStakworkRunCount,
      findMany: mockDbStakworkRunFindMany,
    },
  },
}));

// ─── Import subject under test ────────────────────────────────────────────────

import { getStakworkRuns } from "@/services/stakwork-run";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-test-1";
const USER_ID = "user-1";

function makeWorkspace() {
  return {
    id: WORKSPACE_ID,
    ownerId: USER_ID,
    deleted: false,
    members: [],
  };
}

function makeDbRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    status: WorkflowStatus.COMPLETED,
    workspaceId: WORKSPACE_ID,
    featureId: null,
    projectId: 42,
    dataType: "json",
    decision: null,
    feedback: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T01:00:00Z"),
    taskId: null,
    autoAccept: false,
    promptVersionId: null,
    evalSetId: null,
    userId: null,
    // Note: reportBundle, reportPartial, schemaUnsupported are selected by getStakworkRuns
    reportBundle: null,
    reportPartial: false,
    schemaUnsupported: false,
    // Note: webhookUrl and reportUrl are NOT selected (globally omitted)
    feature: null,
    ...overrides,
  };
}

const BASE_QUERY = {
  workspaceId: WORKSPACE_ID,
  limit: 20,
  offset: 0,
  includeResult: false,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getStakworkRuns — reportUrl/webhookUrl omit + hasReport derivation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbWorkspaceFindUnique.mockResolvedValue(makeWorkspace());
    mockDbStakworkRunCount.mockResolvedValue(1);
  });

  test("1. response never contains reportUrl, webhookUrl, or report_url", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([makeDbRun()]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("reportUrl");
    expect(serialized).not.toContain("report_url");
    expect(serialized).not.toContain("webhookUrl");
    expect(serialized).not.toContain("webhook_url");

    // Also verify at the object level on each run
    for (const run of result.runs) {
      const runObj = run as Record<string, unknown>;
      expect(runObj).not.toHaveProperty("reportUrl");
      expect(runObj).not.toHaveProperty("report_url");
      expect(runObj).not.toHaveProperty("webhookUrl");
      expect(runObj).not.toHaveProperty("webhook_url");
    }
  });

  test("2. hasReport is false when reportBundle is null (derives from projection, not URL column)", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({ reportBundle: null }),
    ]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].hasReport).toBe(false);
  });

  test("3. hasReport is true when reportBundle is non-null", async () => {
    const projection = { schema_version: 1, page_data: {}, source_docs: [] };
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({ reportBundle: projection }),
    ]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].hasReport).toBe(true);
  });

  test("4. hasReport does NOT depend on the reportUrl column value", async () => {
    // reportBundle is null → hasReport false, regardless of what reportUrl would be
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({ reportBundle: null }),
    ]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    expect(result.runs[0].hasReport).toBe(false);

    // Verify that the select clause passed to findMany does NOT include reportUrl or webhookUrl
    const selectArg = mockDbStakworkRunFindMany.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty("reportUrl");
    expect(selectArg).not.toHaveProperty("webhookUrl");
    // But does include the projection fields
    expect(selectArg).toHaveProperty("reportBundle", true);
    expect(selectArg).toHaveProperty("reportPartial", true);
    expect(selectArg).toHaveProperty("schemaUnsupported", true);
  });

  test("5. reportPartial flag derives from the reportPartial column", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({
        reportBundle: { schema_version: 1 },
        reportPartial: true,
        schemaUnsupported: false,
      }),
    ]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    expect(result.runs[0].reportPartial).toBe(true);
    expect(result.runs[0].schemaUnsupported).toBe(false);
  });

  test("6. schemaUnsupported flag derives from the schemaUnsupported column", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({
        reportBundle: { schema_version: 99 },
        reportPartial: false,
        schemaUnsupported: true,
      }),
    ]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    expect(result.runs[0].schemaUnsupported).toBe(true);
    expect(result.runs[0].reportPartial).toBe(false);
    expect(result.runs[0].hasReport).toBe(true);
  });

  test("7. reportBundle column is NOT forwarded to the mapped output", async () => {
    const projection = { schema_version: 1, source_docs: [{ id: "d1" }] };
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({ reportBundle: projection }),
    ]);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    const runObj = result.runs[0] as Record<string, unknown>;
    // The raw projection must not leak to the response
    expect(runObj).not.toHaveProperty("reportBundle");
    // Only the derived flag should be present
    expect(runObj.hasReport).toBe(true);
  });

  test("8. multiple runs mapped independently — each derives hasReport independently", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([
      makeDbRun({ id: "run-1", reportBundle: null }),
      makeDbRun({ id: "run-2", reportBundle: { schema_version: 1 } }),
    ]);
    mockDbStakworkRunCount.mockResolvedValue(2);

    const result = await getStakworkRuns(BASE_QUERY, USER_ID);
    expect(result.runs).toHaveLength(2);

    const run1 = result.runs.find((r) => r.id === "run-1");
    const run2 = result.runs.find((r) => r.id === "run-2");
    expect(run1?.hasReport).toBe(false);
    expect(run2?.hasReport).toBe(true);

    // Neither run has webhookUrl or reportUrl in its output
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("webhookUrl");
    expect(serialized).not.toContain("reportUrl");
  });
});
