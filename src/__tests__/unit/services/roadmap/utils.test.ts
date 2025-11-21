import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    phase: {
      findFirst: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
    },
    feature: {
      findFirst: vi.fn(),
    },
  },
}));

// Import after mocks
import { db } from "@/lib/db";
import { calculateNextOrder } from "@/services/roadmap/utils";

describe("calculateNextOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Edge Cases - Empty Collections", () => {
    test("returns 0 when no items exist in collection", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue(null);

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(0);
      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("returns 0 for task collection with no items", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-123",
        phaseId: "phase-456",
      });

      expect(result).toBe(0);
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123", phaseId: "phase-456" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("returns 0 for feature collection with no items", async () => {
      vi.mocked(db.feature.findFirst).mockResolvedValue(null);

      const result = await calculateNextOrder(db.feature, { workspaceId: "ws-123" });

      expect(result).toBe(0);
      expect(db.feature.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: "ws-123" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });
  });

  describe("Standard Cases - Existing Items", () => {
    test("returns maxOrder + 1 when items exist", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 5 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(6);
      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("returns 1 when only item with order 0 exists", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 0 });

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-123",
        phaseId: "phase-456",
      });

      expect(result).toBe(1);
    });

    test("returns correct next order for large order values", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 999 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(1000);
    });

    test("handles tasks with null phaseId", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 3 });

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-123",
        phaseId: null,
      });

      expect(result).toBe(4);
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123", phaseId: null },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("returns correct order for sequential items", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 15 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(16);
    });
  });

  describe("Different Prisma Models", () => {
    test("works with phase model", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 2 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(3);
      expect(db.phase.findFirst).toHaveBeenCalled();
    });

    test("works with task model", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 7 });

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-123",
        phaseId: "phase-456",
      });

      expect(result).toBe(8);
      expect(db.task.findFirst).toHaveBeenCalled();
    });

    test("works with feature model", async () => {
      vi.mocked(db.feature.findFirst).mockResolvedValue({ order: 12 });

      const result = await calculateNextOrder(db.feature, { workspaceId: "ws-123" });

      expect(result).toBe(13);
      expect(db.feature.findFirst).toHaveBeenCalled();
    });
  });

  describe("Where Clause Variations", () => {
    test("handles simple where clause with single field", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 1 });

      await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("handles complex where clause with multiple fields", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 4 });

      await calculateNextOrder(db.task, {
        featureId: "feature-123",
        phaseId: "phase-456",
        deleted: false,
      });

      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          featureId: "feature-123",
          phaseId: "phase-456",
          deleted: false,
        },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("handles empty where clause", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 10 });

      await calculateNextOrder(db.phase, {});

      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: {},
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("handles where clause with boolean fields", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 6 });

      await calculateNextOrder(db.task, {
        featureId: "feature-123",
        deleted: false,
        archived: false,
      });

      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          featureId: "feature-123",
          deleted: false,
          archived: false,
        },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });
  });

  describe("Query Behavior Verification", () => {
    test("queries with descending order", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 5 });

      await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(db.phase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { order: "desc" },
        }),
      );
    });

    test("selects only order field", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 3 });

      await calculateNextOrder(db.task, { featureId: "feature-123" });

      expect(db.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { order: true },
        }),
      );
    });

    test("passes where clause to query", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 8 });

      const whereClause = { featureId: "feature-123", deleted: false };
      await calculateNextOrder(db.phase, whereClause);

      expect(db.phase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: whereClause,
        }),
      );
    });

    test("calls findFirst exactly once", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 2 });

      await calculateNextOrder(db.task, { featureId: "feature-123" });

      expect(db.task.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("Order Value Edge Cases", () => {
    test("handles order value of 0 correctly", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 0 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(1);
    });

    test("handles negative order values (should not occur but tests robustness)", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: -1 });

      const result = await calculateNextOrder(db.task, { featureId: "feature-123" });

      expect(result).toBe(0);
    });

    test("handles very large order values", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 999999 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-123" });

      expect(result).toBe(1000000);
    });
  });

  describe("Realistic Usage Scenarios", () => {
    test("calculates next order for phases within a feature", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 4 });

      const result = await calculateNextOrder(db.phase, { featureId: "feature-abc" });

      expect(result).toBe(5);
      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-abc" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("calculates next order for tasks within a phase", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 9 });

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-abc",
        phaseId: "phase-xyz",
      });

      expect(result).toBe(10);
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          featureId: "feature-abc",
          phaseId: "phase-xyz",
        },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("calculates next order for tasks without phase (feature-level tasks)", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 2 });

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-abc",
        phaseId: null,
      });

      expect(result).toBe(3);
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          featureId: "feature-abc",
          phaseId: null,
        },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("calculates next order for first item in empty phase", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const result = await calculateNextOrder(db.task, {
        featureId: "feature-new",
        phaseId: "phase-new",
      });

      expect(result).toBe(0);
    });
  });

  describe("Error Handling", () => {
    test("propagates Prisma database errors", async () => {
      const dbError = new Error("Database connection failed");
      vi.mocked(db.phase.findFirst).mockRejectedValue(dbError);

      await expect(calculateNextOrder(db.phase, { featureId: "feature-123" })).rejects.toThrow(
        "Database connection failed",
      );

      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("propagates Prisma query errors for tasks", async () => {
      const queryError = new Error("Invalid query syntax");
      vi.mocked(db.task.findFirst).mockRejectedValue(queryError);

      await expect(calculateNextOrder(db.task, { featureId: "feature-123", phaseId: "phase-456" })).rejects.toThrow(
        "Invalid query syntax",
      );
    });

    test("propagates Prisma timeout errors", async () => {
      const timeoutError = new Error("Query timeout exceeded");
      vi.mocked(db.feature.findFirst).mockRejectedValue(timeoutError);

      await expect(calculateNextOrder(db.feature, { workspaceId: "ws-123" })).rejects.toThrow("Query timeout exceeded");
    });

    test("propagates Prisma constraint violation errors", async () => {
      const constraintError = new Error("Foreign key constraint violation");
      vi.mocked(db.phase.findFirst).mockRejectedValue(constraintError);

      await expect(calculateNextOrder(db.phase, { featureId: "non-existent-feature" })).rejects.toThrow(
        "Foreign key constraint violation",
      );
    });
  });

  /**
   * NOTE: Concurrent insert testing
   *
   * Concurrent insert safety cannot be properly tested in unit tests because:
   * 1. Unit tests mock the database (no real transactions or locking)
   * 2. Concurrent safety depends on database isolation levels and row locking
   * 3. The calculateNextOrder function itself doesn't implement concurrency control
   *
   * Concurrent insert scenarios are tested at the integration level in:
   * - src/__tests__/integration/api/tickets-reorder.test.ts
   * - src/__tests__/integration/api/repository-update.test.ts
   *
   * These integration tests use Promise.all patterns with real database connections
   * to verify that concurrent operations are handled correctly by Prisma and PostgreSQL.
   */
});
