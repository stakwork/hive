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
      findUnique: vi.fn(),
    },
  },
}));

// Import after mocks
import { db } from "@/lib/db";
import { calculateNextOrder, validateFeatureAccess } from "@/services/roadmap/utils";

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
        })
      );
    });

    test("selects only order field", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({ order: 3 });

      await calculateNextOrder(db.task, { featureId: "feature-123" });

      expect(db.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { order: true },
        })
      );
    });

    test("passes where clause to query", async () => {
      vi.mocked(db.phase.findFirst).mockResolvedValue({ order: 8 });

      const whereClause = { featureId: "feature-123", deleted: false };
      await calculateNextOrder(db.phase, whereClause);

      expect(db.phase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: whereClause,
        })
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

      await expect(
        calculateNextOrder(db.phase, { featureId: "feature-123" })
      ).rejects.toThrow("Database connection failed");

      expect(db.phase.findFirst).toHaveBeenCalledWith({
        where: { featureId: "feature-123" },
        orderBy: { order: "desc" },
        select: { order: true },
      });
    });

    test("propagates Prisma query errors for tasks", async () => {
      const queryError = new Error("Invalid query syntax");
      vi.mocked(db.task.findFirst).mockRejectedValue(queryError);

      await expect(
        calculateNextOrder(db.task, { featureId: "feature-123", phaseId: "phase-456" })
      ).rejects.toThrow("Invalid query syntax");
    });

    test("propagates Prisma timeout errors", async () => {
      const timeoutError = new Error("Query timeout exceeded");
      vi.mocked(db.feature.findFirst).mockRejectedValue(timeoutError);

      await expect(
        calculateNextOrder(db.feature, { workspaceId: "ws-123" })
      ).rejects.toThrow("Query timeout exceeded");
    });

    test("propagates Prisma constraint violation errors", async () => {
      const constraintError = new Error("Foreign key constraint violation");
      vi.mocked(db.phase.findFirst).mockRejectedValue(constraintError);

      await expect(
        calculateNextOrder(db.phase, { featureId: "non-existent-feature" })
      ).rejects.toThrow("Foreign key constraint violation");
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

describe("validateFeatureAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Successful Access - Workspace Owner", () => {
    test("grants access when user is workspace owner", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        select: {
          id: true,
          workspaceId: true,
          deleted: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: "user-789" },
                select: { role: true },
              },
            },
          },
        },
      });
    });

    test("grants access to owner even when they are also a member", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [{ role: "ADMIN" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });
  });

  describe("Successful Access - Workspace Member", () => {
    test("grants access when user is workspace member", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "DEVELOPER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        select: {
          id: true,
          workspaceId: true,
          deleted: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: "user-789" },
                select: { role: true },
              },
            },
          },
        },
      });
    });

    test("grants access to member with ADMIN role", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "ADMIN" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });

    test("grants access to member with PM role", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "PM" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });

    test("grants access to member with STAKEHOLDER role", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "STAKEHOLDER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });

    test("grants access to member with VIEWER role", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "VIEWER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });
  });

  describe("Access Denied - Not Found Errors", () => {
    test("throws 'Feature not found' when feature does not exist", async () => {
      vi.mocked(db.feature.findUnique).mockResolvedValue(null);

      await expect(validateFeatureAccess("non-existent", "user-789")).rejects.toThrow(
        "Feature not found"
      );

      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "non-existent" },
        select: {
          id: true,
          workspaceId: true,
          deleted: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: "user-789" },
                select: { role: true },
              },
            },
          },
        },
      });
    });

    test("throws 'Feature not found' when workspace is soft-deleted", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: true,
          members: [{ role: "DEVELOPER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Feature not found"
      );
    });

    test("throws 'Feature not found' for deleted workspace even if user is owner", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: true,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Feature not found"
      );
    });

    test("throws 'Feature not found' when feature is soft-deleted", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        deleted: true,
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Feature not found"
      );
    });

    test("throws 'Feature not found' for soft-deleted feature even if user is owner", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        deleted: true,
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [{ role: "OWNER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Feature not found"
      );
    });
  });

  describe("Access Denied - Permission Errors", () => {
    test("throws 'Access denied' when user is not owner or member", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Access denied"
      );

      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        select: {
          id: true,
          workspaceId: true,
          deleted: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: "user-789" },
                select: { role: true },
              },
            },
          },
        },
      });
    });

    test("throws 'Access denied' when members array is empty", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "unauthorized-user")).rejects.toThrow(
        "Access denied"
      );
    });

    test("throws 'Access denied' when user ID does not match owner or any member", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "random-user-id")).rejects.toThrow(
        "Access denied"
      );
    });
  });

  describe("Query Structure Verification", () => {
    test("queries with correct feature ID in where clause", async () => {
      const mockFeature = {
        id: "feature-abc",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-xyz",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await validateFeatureAccess("feature-abc", "user-xyz");

      expect(db.feature.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "feature-abc" },
        })
      );
    });

    test("filters members by userId in query", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "DEVELOPER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await validateFeatureAccess("feature-123", "member-123");

      expect(db.feature.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            workspace: expect.objectContaining({
              select: expect.objectContaining({
                members: {
                  where: { userId: "member-123" },
                  select: { role: true },
                },
              }),
            }),
          }),
        })
      );
    });

    test("selects all required fields from feature and workspace", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await validateFeatureAccess("feature-123", "user-789");

      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        select: {
          id: true,
          workspaceId: true,
          deleted: true,
          workspace: {
            select: {
              id: true,
              ownerId: true,
              deleted: true,
              members: {
                where: { userId: "user-789" },
                select: { role: true },
              },
            },
          },
        },
      });
    });

    test("calls findUnique exactly once", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await validateFeatureAccess("feature-123", "user-789");

      expect(db.feature.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("Access Control Logic", () => {
    test("prioritizes owner check before member check", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [{ role: "ADMIN" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });

    test("uses member check when user is not owner", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "DEVELOPER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
    });

    test("validates deleted flag before permission checks", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: true,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Feature not found"
      );
    });
  });

  describe("Edge Cases", () => {
    test("handles empty string feature ID gracefully", async () => {
      vi.mocked(db.feature.findUnique).mockResolvedValue(null);

      await expect(validateFeatureAccess("", "user-789")).rejects.toThrow(
        "Feature not found"
      );

      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "" },
        select: expect.any(Object),
      });
    });

    test("handles empty string user ID", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(validateFeatureAccess("feature-123", "")).rejects.toThrow(
        "Access denied"
      );
    });

    test("handles special characters in IDs", async () => {
      const mockFeature = {
        id: "feature-!@#$",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-!@#$",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-!@#$", "user-!@#$");

      expect(result).toEqual(mockFeature);
    });

    test("handles UUID format feature IDs", async () => {
      const featureId = "550e8400-e29b-41d4-a716-446655440000";
      const userId = "650e8400-e29b-41d4-a716-446655440001";

      const mockFeature = {
        id: featureId,
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: userId,
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess(featureId, userId);

      expect(result).toEqual(mockFeature);
    });

    test("handles CUID format feature IDs", async () => {
      const featureId = "clh0x8y5k0000qh08z0dqz0dq";
      const userId = "clh0x8y5k0001qh08z0dqz0dr";

      const mockFeature = {
        id: featureId,
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: userId,
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess(featureId, userId);

      expect(result).toEqual(mockFeature);
    });
  });

  describe("Error Handling", () => {
    test("propagates database connection errors", async () => {
      const dbError = new Error("Database connection failed");
      vi.mocked(db.feature.findUnique).mockRejectedValue(dbError);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Database connection failed"
      );

      expect(db.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        select: expect.any(Object),
      });
    });

    test("propagates Prisma query timeout errors", async () => {
      const timeoutError = new Error("Query timeout exceeded");
      vi.mocked(db.feature.findUnique).mockRejectedValue(timeoutError);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Query timeout exceeded"
      );
    });

    test("propagates Prisma constraint errors", async () => {
      const constraintError = new Error("Foreign key constraint violation");
      vi.mocked(db.feature.findUnique).mockRejectedValue(constraintError);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Foreign key constraint violation"
      );
    });

    test("propagates network errors", async () => {
      const networkError = new Error("Network error occurred");
      vi.mocked(db.feature.findUnique).mockRejectedValue(networkError);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Network error occurred"
      );
    });

    test("propagates unexpected runtime errors", async () => {
      const runtimeError = new Error("Unexpected runtime error");
      vi.mocked(db.feature.findUnique).mockRejectedValue(runtimeError);

      await expect(validateFeatureAccess("feature-123", "user-789")).rejects.toThrow(
        "Unexpected runtime error"
      );
    });
  });

  describe("Return Value Verification", () => {
    test("returns complete feature object with workspace data", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "user-789",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result).toEqual(mockFeature);
      expect(result.id).toBe("feature-123");
      expect(result.workspaceId).toBe("ws-456");
      expect(result.workspace.id).toBe("ws-456");
      expect(result.workspace.ownerId).toBe("user-789");
      expect(result.workspace.deleted).toBe(false);
      expect(result.workspace.members).toEqual([]);
    });

    test("returns feature with member data when user is member", async () => {
      const mockFeature = {
        id: "feature-123",
        workspaceId: "ws-456",
        workspace: {
          id: "ws-456",
          ownerId: "owner-999",
          deleted: false,
          members: [{ role: "DEVELOPER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-123", "user-789");

      expect(result.workspace.members).toHaveLength(1);
      expect(result.workspace.members[0].role).toBe("DEVELOPER");
    });
  });

  describe("Real-World Usage Scenarios", () => {
    test("validates access for feature detail page view", async () => {
      const mockFeature = {
        id: "feature-prod-123",
        workspaceId: "ws-production",
        workspace: {
          id: "ws-production",
          ownerId: "owner-alice",
          deleted: false,
          members: [{ role: "PM" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-prod-123", "pm-bob");

      expect(result).toEqual(mockFeature);
    });

    test("validates access for feature update operation", async () => {
      const mockFeature = {
        id: "feature-update-456",
        workspaceId: "ws-staging",
        workspace: {
          id: "ws-staging",
          ownerId: "owner-charlie",
          deleted: false,
          members: [{ role: "DEVELOPER" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      const result = await validateFeatureAccess("feature-update-456", "dev-dave");

      expect(result).toEqual(mockFeature);
    });

    test("blocks access from external user trying to view private feature", async () => {
      const mockFeature = {
        id: "feature-private-789",
        workspaceId: "ws-secure",
        workspace: {
          id: "ws-secure",
          ownerId: "owner-eve",
          deleted: false,
          members: [],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(
        validateFeatureAccess("feature-private-789", "external-user")
      ).rejects.toThrow("Access denied");
    });

    test("blocks access to archived workspace feature", async () => {
      const mockFeature = {
        id: "feature-archived-101",
        workspaceId: "ws-archived",
        workspace: {
          id: "ws-archived",
          ownerId: "owner-frank",
          deleted: true,
          members: [{ role: "ADMIN" }],
        },
      };

      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature);

      await expect(
        validateFeatureAccess("feature-archived-101", "admin-grace")
      ).rejects.toThrow("Feature not found");
    });
  });

  /**
   * NOTE: Integration testing coverage
   * 
   * While these unit tests verify the business logic of validateFeatureAccess in isolation,
   * the function is also extensively tested at the integration level in:
   * - src/__tests__/integration/api/features-featureId.test.ts
   * - src/__tests__/integration/api/features-tickets.test.ts
   * 
   * Integration tests validate:
   * - Real database queries and transactions
   * - Full authentication flow with NextAuth
   * - HTTP request/response handling
   * - End-to-end access control enforcement
   * 
   * Unit tests focus on:
   * - Permission logic correctness
   * - Error handling paths
   * - Edge cases with mocked data
   * - Query structure verification
   */
});
