import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DependencyCheckResult } from "@/services/task-coordinator-cron";

/**
 * Unit tests for checkDependencies mapping to snapshot actions.
 *
 * The snapshot endpoint calls checkDependencies per candidate task and maps:
 *   SATISFIED          → action: "DISPATCH"
 *   PENDING            → action: "SKIP_PENDING"
 *   PERMANENTLY_BLOCKED → action: "SKIP_BLOCKED"
 */

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
    },
  },
}));

const { db: mockDb } = await import("@/lib/db");
const { checkDependencies } = await import("@/services/task-coordinator-cron");

// Helper: maps checkDependencies result to snapshot action (mirrors route logic)
function mapResultToAction(result: DependencyCheckResult): string {
  if (result === "SATISFIED") return "DISPATCH";
  if (result === "PENDING") return "SKIP_PENDING";
  return "SKIP_BLOCKED";
}

const mockFindMany = mockDb.task.findMany as ReturnType<typeof vi.fn>;

describe("checkDependencies → snapshot action mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps SATISFIED result to "DISPATCH"', async () => {
    // No dependency IDs → always SATISFIED
    const result = await checkDependencies([]);
    expect(result).toBe("SATISFIED");
    expect(mapResultToAction(result)).toBe("DISPATCH");
  });

  it('maps PENDING result to "SKIP_PENDING"', async () => {
    // Dependency task is IN_PROGRESS (no PR) → PENDING
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-1",
        status: "IN_PROGRESS",
        chatMessages: [],
      },
    ]);

    const result = await checkDependencies(["dep-task-1"]);
    expect(result).toBe("PENDING");
    expect(mapResultToAction(result)).toBe("SKIP_PENDING");
  });

  it('maps PERMANENTLY_BLOCKED result to "SKIP_BLOCKED" when dep is CANCELLED (no PR)', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-2",
        status: "CANCELLED",
        chatMessages: [],
      },
    ]);

    const result = await checkDependencies(["dep-task-2"]);
    expect(result).toBe("PERMANENTLY_BLOCKED");
    expect(mapResultToAction(result)).toBe("SKIP_BLOCKED");
  });

  it('maps PERMANENTLY_BLOCKED to "SKIP_BLOCKED" when dep has a CANCELLED PR artifact', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-3",
        status: "IN_PROGRESS",
        chatMessages: [
          {
            createdAt: new Date(),
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: { status: "CANCELLED", url: "https://github.com/org/repo/pull/42" },
                createdAt: new Date(),
              },
            ],
          },
        ],
      },
    ]);

    const result = await checkDependencies(["dep-task-3"]);
    expect(result).toBe("PERMANENTLY_BLOCKED");
    expect(mapResultToAction(result)).toBe("SKIP_BLOCKED");
  });

  it('maps SATISFIED to "DISPATCH" when all deps are DONE (no PR)', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-4",
        status: "DONE",
        chatMessages: [],
      },
    ]);

    const result = await checkDependencies(["dep-task-4"]);
    expect(result).toBe("SATISFIED");
    expect(mapResultToAction(result)).toBe("DISPATCH");
  });

  it('maps SATISFIED to "DISPATCH" when dep has a DONE PR artifact', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-5",
        status: "IN_PROGRESS",
        chatMessages: [
          {
            createdAt: new Date(),
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: { status: "DONE", url: "https://github.com/org/repo/pull/99" },
                createdAt: new Date(),
              },
            ],
          },
        ],
      },
    ]);

    const result = await checkDependencies(["dep-task-5"]);
    expect(result).toBe("SATISFIED");
    expect(mapResultToAction(result)).toBe("DISPATCH");
  });

  it('maps PENDING to "SKIP_PENDING" when dep has an open (IN_PROGRESS) PR artifact', async () => {
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-6",
        status: "IN_PROGRESS",
        chatMessages: [
          {
            createdAt: new Date(),
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: { status: "IN_PROGRESS", url: "https://github.com/org/repo/pull/7" },
                createdAt: new Date(),
              },
            ],
          },
        ],
      },
    ]);

    const result = await checkDependencies(["dep-task-6"]);
    expect(result).toBe("PENDING");
    expect(mapResultToAction(result)).toBe("SKIP_PENDING");
  });

  it("returns PENDING for missing (not-found) dependency tasks", async () => {
    // Only 1 of the 2 requested tasks was found → mismatch → PENDING
    mockFindMany.mockResolvedValueOnce([
      {
        id: "dep-task-7",
        status: "DONE",
        chatMessages: [],
      },
    ]);

    const result = await checkDependencies(["dep-task-7", "dep-task-missing"]);
    expect(result).toBe("PENDING");
    expect(mapResultToAction(result)).toBe("SKIP_PENDING");
  });
});
