import { describe, test, expect } from "vitest";

// ---------------------------------------------------------------------------
// We test the pure logic extracted from mcpTools.ts without importing the
// module (which has heavy DB / Prisma dependencies). Instead we inline the
// relevant types and functions under test.
// ---------------------------------------------------------------------------

interface StatusItem {
  type: "feature" | "task";
  id: string;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  needsAttention: boolean;
  updatedAt: string;
  brief?: string | null;
  branch?: string | null;
}

function statusItemComparator(a: StatusItem, b: StatusItem): number {
  if (a.needsAttention !== b.needsAttention) {
    return a.needsAttention ? -1 : 1;
  }
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function makeItem(
  overrides: Partial<StatusItem> & { id: string; updatedAt: string },
): StatusItem {
  return {
    type: "task",
    title: "Test item",
    status: "TODO",
    priority: "MEDIUM",
    workflowStatus: null,
    needsAttention: false,
    ...overrides,
  };
}

describe("statusItemComparator", () => {
  test("needsAttention=true sorts before needsAttention=false", () => {
    const attention = makeItem({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z",
      needsAttention: true,
    });
    const normal = makeItem({
      id: "b",
      updatedAt: "2026-01-02T00:00:00Z",
      needsAttention: false,
    });

    // Even though 'normal' has a newer updatedAt, 'attention' should come first
    expect(statusItemComparator(attention, normal)).toBeLessThan(0);
    expect(statusItemComparator(normal, attention)).toBeGreaterThan(0);
  });

  test("within needsAttention=true tier, newer updatedAt sorts first", () => {
    const older = makeItem({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z",
      needsAttention: true,
    });
    const newer = makeItem({
      id: "b",
      updatedAt: "2026-01-03T00:00:00Z",
      needsAttention: true,
    });

    expect(statusItemComparator(newer, older)).toBeLessThan(0);
    expect(statusItemComparator(older, newer)).toBeGreaterThan(0);
  });

  test("within needsAttention=false tier, newer updatedAt sorts first", () => {
    const older = makeItem({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z",
      needsAttention: false,
    });
    const newer = makeItem({
      id: "b",
      updatedAt: "2026-01-05T00:00:00Z",
      needsAttention: false,
    });

    expect(statusItemComparator(newer, older)).toBeLessThan(0);
    expect(statusItemComparator(older, newer)).toBeGreaterThan(0);
  });

  test("items with equal needsAttention and equal updatedAt compare as 0", () => {
    const a = makeItem({
      id: "a",
      updatedAt: "2026-02-15T12:00:00Z",
      needsAttention: true,
    });
    const b = makeItem({
      id: "b",
      updatedAt: "2026-02-15T12:00:00Z",
      needsAttention: true,
    });

    expect(statusItemComparator(a, b)).toBe(0);
  });

  test("full sort: mixed attention + recency produces correct order", () => {
    const items: StatusItem[] = [
      makeItem({
        id: "no-old",
        updatedAt: "2026-01-01T00:00:00Z",
        needsAttention: false,
      }),
      makeItem({
        id: "yes-old",
        updatedAt: "2026-01-02T00:00:00Z",
        needsAttention: true,
      }),
      makeItem({
        id: "no-new",
        updatedAt: "2026-01-05T00:00:00Z",
        needsAttention: false,
      }),
      makeItem({
        id: "yes-new",
        updatedAt: "2026-01-10T00:00:00Z",
        needsAttention: true,
      }),
    ];

    items.sort(statusItemComparator);

    expect(items.map((i) => i.id)).toEqual([
      "yes-new",
      "yes-old",
      "no-new",
      "no-old",
    ]);
  });
});

describe("needsAttention flag derivation", () => {
  // Mirror the mapping logic from fetchStatusItems
  function deriveNeedsAttention(workflowStatus: string | null): boolean {
    return workflowStatus === "COMPLETED";
  }

  test("workflowStatus === 'COMPLETED' yields needsAttention: true", () => {
    expect(deriveNeedsAttention("COMPLETED")).toBe(true);
  });

  test("workflowStatus === 'IN_PROGRESS' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("IN_PROGRESS")).toBe(false);
  });

  test("workflowStatus === 'PENDING' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("PENDING")).toBe(false);
  });

  test("workflowStatus === null yields needsAttention: false", () => {
    expect(deriveNeedsAttention(null)).toBe(false);
  });

  test("workflowStatus === 'FAILED' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("FAILED")).toBe(false);
  });

  test("workflowStatus === 'HALTED' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("HALTED")).toBe(false);
  });
});
