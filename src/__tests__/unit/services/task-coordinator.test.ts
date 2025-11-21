import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { buildFeatureContext } from "@/services/task-coordinator";
import { db } from "@/lib/db";

// Mock Prisma db client
vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      findUnique: vi.fn(),
    },
    phase: {
      findUnique: vi.fn(),
    },
  },
}));

describe("buildFeatureContext", () => {
  const mockDb = db as unknown as {
    feature: { findUnique: ReturnType<typeof vi.fn> };
    phase: { findUnique: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Valid Context Construction", () => {
    test("should return complete FeatureContext with all fields populated", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Payment Integration",
        brief: "Add Stripe payment processing",
        requirements: "Support credit cards and ACH payments",
        architecture: "Microservice-based payment gateway",
        userStories: [
          { id: "us-1", title: "As a customer, I want to pay by credit card", order: 0 },
          { id: "us-2", title: "As a customer, I want to pay by bank transfer", order: 1 },
        ],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Development Phase",
        description: "Implementation and testing",
        tasks: [
          { id: "task-1", title: "Setup Stripe API", description: "Configure Stripe SDK", status: "TODO" },
          { id: "task-2", title: "Create payment endpoint", description: "Build REST API", status: "IN_PROGRESS" },
        ],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result).toEqual({
        feature: {
          title: "Payment Integration",
          brief: "Add Stripe payment processing",
          userStories: ["As a customer, I want to pay by credit card", "As a customer, I want to pay by bank transfer"],
          requirements: "Support credit cards and ACH payments",
          architecture: "Microservice-based payment gateway",
        },
        currentPhase: {
          name: "Development Phase",
          description: "Implementation and testing",
          tickets: [
            { id: "task-1", title: "Setup Stripe API", description: "Configure Stripe SDK", status: "TODO" },
            { id: "task-2", title: "Create payment endpoint", description: "Build REST API", status: "IN_PROGRESS" },
          ],
        },
      });
    });

    test("should query database with correct parameters", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      await buildFeatureContext("feature-1", "phase-1");

      expect(mockDb.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "feature-1" },
        include: {
          userStories: {
            orderBy: { order: "asc" },
          },
        },
      });

      expect(mockDb.phase.findUnique).toHaveBeenCalledWith({
        where: { id: "phase-1" },
        include: {
          tasks: {
            where: { deleted: false },
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
            },
          },
        },
      });
    });

    test("should handle feature with minimal data", async () => {
      const mockFeature = {
        id: "feature-minimal",
        title: "Minimal Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-minimal",
        name: "Minimal Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-minimal", "phase-minimal");

      expect(result).toEqual({
        feature: {
          title: "Minimal Feature",
          brief: null,
          userStories: [],
          requirements: null,
          architecture: null,
        },
        currentPhase: {
          name: "Minimal Phase",
          description: null,
          tickets: [],
        },
      });
    });
  });

  describe("Missing Entities", () => {
    test("should throw error when feature not found", async () => {
      mockDb.feature.findUnique.mockResolvedValue(null);
      mockDb.phase.findUnique.mockResolvedValue({
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      });

      await expect(buildFeatureContext("invalid-feature-id", "phase-1")).rejects.toThrow(
        "Feature or Phase not found: invalid-feature-id, phase-1",
      );

      expect(mockDb.feature.findUnique).toHaveBeenCalledWith({
        where: { id: "invalid-feature-id" },
        include: {
          userStories: {
            orderBy: { order: "asc" },
          },
        },
      });
    });

    test("should throw error when phase not found", async () => {
      mockDb.feature.findUnique.mockResolvedValue({
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      });
      mockDb.phase.findUnique.mockResolvedValue(null);

      await expect(buildFeatureContext("feature-1", "invalid-phase-id")).rejects.toThrow(
        "Feature or Phase not found: feature-1, invalid-phase-id",
      );

      expect(mockDb.phase.findUnique).toHaveBeenCalledWith({
        where: { id: "invalid-phase-id" },
        include: {
          tasks: {
            where: { deleted: false },
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
            },
          },
        },
      });
    });

    test("should throw error when both feature and phase not found", async () => {
      mockDb.feature.findUnique.mockResolvedValue(null);
      mockDb.phase.findUnique.mockResolvedValue(null);

      await expect(buildFeatureContext("invalid-feature", "invalid-phase")).rejects.toThrow(
        "Feature or Phase not found: invalid-feature, invalid-phase",
      );
    });

    test("should include both IDs in error message", async () => {
      mockDb.feature.findUnique.mockResolvedValue(null);
      mockDb.phase.findUnique.mockResolvedValue(null);

      await expect(buildFeatureContext("feature-abc", "phase-xyz")).rejects.toThrow(
        "Feature or Phase not found: feature-abc, phase-xyz",
      );
    });
  });

  describe("Null Field Handling", () => {
    test("should handle null brief field", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: "Some requirements",
        architecture: "Some architecture",
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Some description",
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.brief).toBeNull();
      expect(result.feature.requirements).toBe("Some requirements");
      expect(result.feature.architecture).toBe("Some architecture");
    });

    test("should handle null requirements field", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: null,
        architecture: "Some architecture",
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Some description",
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.requirements).toBeNull();
      expect(result.feature.brief).toBe("Some brief");
      expect(result.feature.architecture).toBe("Some architecture");
    });

    test("should handle null architecture field", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: "Some requirements",
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Some description",
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.architecture).toBeNull();
      expect(result.feature.brief).toBe("Some brief");
      expect(result.feature.requirements).toBe("Some requirements");
    });

    test("should handle null phase description", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: "Some requirements",
        architecture: "Some architecture",
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.currentPhase.description).toBeNull();
      expect(result.currentPhase.name).toBe("Test Phase");
    });

    test("should handle all null optional fields", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.brief).toBeNull();
      expect(result.feature.requirements).toBeNull();
      expect(result.feature.architecture).toBeNull();
      expect(result.currentPhase.description).toBeNull();
    });

    test("should handle null task description", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Phase description",
        tasks: [
          { id: "task-1", title: "Task 1", description: null, status: "TODO" },
          { id: "task-2", title: "Task 2", description: "Task description", status: "IN_PROGRESS" },
        ],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.currentPhase.tickets[0].description).toBeNull();
      expect(result.currentPhase.tickets[1].description).toBe("Task description");
    });
  });

  describe("Empty Collections", () => {
    test("should handle empty userStories array", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: "Some requirements",
        architecture: "Some architecture",
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Some description",
        tasks: [{ id: "task-1", title: "Task 1", description: "Description", status: "TODO" }],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.userStories).toEqual([]);
      expect(Array.isArray(result.feature.userStories)).toBe(true);
    });

    test("should handle empty tasks array", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: "Some requirements",
        architecture: "Some architecture",
        userStories: [{ id: "us-1", title: "User Story 1", order: 0 }],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Some description",
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.currentPhase.tickets).toEqual([]);
      expect(Array.isArray(result.currentPhase.tickets)).toBe(true);
    });

    test("should handle both empty userStories and tasks arrays", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.userStories).toEqual([]);
      expect(result.currentPhase.tickets).toEqual([]);
    });
  });

  describe("Data Transformation", () => {
    test("should map userStories to title strings only", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Some brief",
        requirements: null,
        architecture: null,
        userStories: [
          { id: "us-1", title: "First user story", order: 0, description: "Some description" },
          { id: "us-2", title: "Second user story", order: 1, description: "Another description" },
          { id: "us-3", title: "Third user story", order: 2, description: null },
        ],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.userStories).toEqual(["First user story", "Second user story", "Third user story"]);
      expect(result.feature.userStories.length).toBe(3);
      expect(result.feature.userStories.every((story) => typeof story === "string")).toBe(true);
    });

    test("should preserve userStories order from database", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [
          { id: "us-3", title: "Third story", order: 2 },
          { id: "us-1", title: "First story", order: 0 },
          { id: "us-2", title: "Second story", order: 1 },
        ],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      // Database query includes orderBy: { order: "asc" }, so the order should be preserved
      expect(result.feature.userStories).toEqual(["Third story", "First story", "Second story"]);
    });

    test("should preserve task objects without transformation", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [
          { id: "task-1", title: "Task 1", description: "Description 1", status: "TODO" },
          { id: "task-2", title: "Task 2", description: null, status: "IN_PROGRESS" },
        ],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      // Tasks should be preserved as full objects, not transformed
      expect(result.currentPhase.tickets).toEqual([
        { id: "task-1", title: "Task 1", description: "Description 1", status: "TODO" },
        { id: "task-2", title: "Task 2", description: null, status: "IN_PROGRESS" },
      ]);
      expect(result.currentPhase.tickets[0]).toHaveProperty("id");
      expect(result.currentPhase.tickets[0]).toHaveProperty("description");
      expect(result.currentPhase.tickets[0]).toHaveProperty("status");
    });
  });

  describe("Task Filtering", () => {
    test("should only include non-deleted tasks", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      // Database query filters deleted tasks, so only non-deleted tasks are returned
      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [
          { id: "task-1", title: "Active Task 1", description: "Description", status: "TODO" },
          { id: "task-2", title: "Active Task 2", description: "Description", status: "IN_PROGRESS" },
        ],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.currentPhase.tickets).toHaveLength(2);
      expect(result.currentPhase.tickets[0].title).toBe("Active Task 1");
      expect(result.currentPhase.tickets[1].title).toBe("Active Task 2");
    });

    test("should verify database query filters deleted tasks", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      await buildFeatureContext("feature-1", "phase-1");

      expect(mockDb.phase.findUnique).toHaveBeenCalledWith({
        where: { id: "phase-1" },
        include: {
          tasks: {
            where: { deleted: false },
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
            },
          },
        },
      });
    });
  });

  describe("Database Errors", () => {
    test("should propagate database error from feature query", async () => {
      mockDb.feature.findUnique.mockRejectedValue(new Error("Database connection failed"));
      mockDb.phase.findUnique.mockResolvedValue({
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      });

      await expect(buildFeatureContext("feature-1", "phase-1")).rejects.toThrow("Database connection failed");

      expect(mockDb.feature.findUnique).toHaveBeenCalledTimes(1);
    });

    test("should propagate database error from phase query", async () => {
      mockDb.feature.findUnique.mockResolvedValue({
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      });
      mockDb.phase.findUnique.mockRejectedValue(new Error("Phase query timeout"));

      await expect(buildFeatureContext("feature-1", "phase-1")).rejects.toThrow("Phase query timeout");

      expect(mockDb.phase.findUnique).toHaveBeenCalledTimes(1);
    });

    test("should handle network errors", async () => {
      mockDb.feature.findUnique.mockRejectedValue(new Error("ECONNREFUSED"));
      mockDb.phase.findUnique.mockResolvedValue({
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      });

      await expect(buildFeatureContext("feature-1", "phase-1")).rejects.toThrow("ECONNREFUSED");
    });

    test("should handle generic database errors", async () => {
      mockDb.feature.findUnique.mockRejectedValue(new Error("Internal database error"));
      mockDb.phase.findUnique.mockResolvedValue({
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      });

      await expect(buildFeatureContext("feature-1", "phase-1")).rejects.toThrow("Internal database error");
    });
  });

  describe("Edge Cases", () => {
    test("should handle special characters in feature title", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Feature with 🚀 emojis & special <html> chars: àáâäåæçèéêë",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.title).toBe("Feature with 🚀 emojis & special <html> chars: àáâäåæçèéêë");
    });

    test("should handle very long text fields", async () => {
      const longText = "a".repeat(10000);
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: longText,
        requirements: longText,
        architecture: longText,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: longText,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.brief).toBe(longText);
      expect(result.feature.requirements).toBe(longText);
      expect(result.feature.architecture).toBe(longText);
      expect(result.currentPhase.description).toBe(longText);
    });

    test("should handle large number of userStories", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: Array.from({ length: 100 }, (_, i) => ({
          id: `us-${i}`,
          title: `User Story ${i}`,
          order: i,
        })),
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.feature.userStories).toHaveLength(100);
      expect(result.feature.userStories[0]).toBe("User Story 0");
      expect(result.feature.userStories[99]).toBe("User Story 99");
    });

    test("should handle large number of tasks", async () => {
      const mockFeature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: null,
        tasks: Array.from({ length: 100 }, (_, i) => ({
          id: `task-${i}`,
          title: `Task ${i}`,
          description: `Description ${i}`,
          status: "TODO",
        })),
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext("feature-1", "phase-1");

      expect(result.currentPhase.tickets).toHaveLength(100);
      expect(result.currentPhase.tickets[0].title).toBe("Task 0");
      expect(result.currentPhase.tickets[99].title).toBe("Task 99");
    });

    test("should handle UUID format IDs", async () => {
      const featureUuid = "550e8400-e29b-41d4-a716-446655440000";
      const phaseUuid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

      const mockFeature = {
        id: featureUuid,
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        userStories: [],
      };

      const mockPhase = {
        id: phaseUuid,
        name: "Test Phase",
        description: null,
        tasks: [],
      };

      mockDb.feature.findUnique.mockResolvedValue(mockFeature);
      mockDb.phase.findUnique.mockResolvedValue(mockPhase);

      const result = await buildFeatureContext(featureUuid, phaseUuid);

      expect(result.feature.title).toBe("Test Feature");
      expect(result.currentPhase.name).toBe("Test Phase");
    });
  });
});
