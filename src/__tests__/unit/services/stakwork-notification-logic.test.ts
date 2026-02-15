import { describe, it, expect } from "vitest";
import { StakworkRunType } from "@prisma/client";

/**
 * Helper function to compute pending run types (same logic as in production code)
 */
function computePendingRunTypes(
  runs: Array<{ type: StakworkRunType; decision: string | null; createdAt: Date }>,
  hasTasks = false
): Set<StakworkRunType> {
  // Group runs by type and keep only the most recent run per type
  const latestPerType = new Map<StakworkRunType, { type: StakworkRunType; decision: string | null }>();
  runs.forEach((run) => {
    if (!latestPerType.has(run.type)) {
      latestPerType.set(run.type, run);
    }
  });

  // Filter for latest runs that need attention (decision is null)
  const pendingTypes = new Set<StakworkRunType>(
    Array.from(latestPerType.values())
      .filter((run) => {
        if (run.decision !== null) return false;
        // If tasks already exist, don't show indicator for TASK_GENERATION
        if (run.type === "TASK_GENERATION" && hasTasks) return false;
        return ["ARCHITECTURE", "REQUIREMENTS", "TASK_GENERATION", "USER_STORIES"].includes(run.type);
      })
      .map((run) => run.type)
  );

  return pendingTypes;
}

/**
 * Helper function to compute pending count per feature (for features list)
 */
function computePendingCount(
  runs: Array<{ type: StakworkRunType; decision: string | null; createdAt: Date }>
): number {
  const latestPerType = new Map();
  runs.forEach((run) => {
    if (!latestPerType.has(run.type)) {
      latestPerType.set(run.type, run);
    }
  });
  
  return Array.from(latestPerType.values())
    .filter((run) => run.decision === null).length;
}

describe("Stakwork Notification Logic", () => {
  describe("computePendingRunTypes", () => {
    it("should only consider the latest run per type", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-01-01"), // Older run with pending decision
        },
      ];

      const pendingTypes = computePendingRunTypes(runs);

      // Should NOT include ARCHITECTURE because the latest run is ACCEPTED
      expect(pendingTypes.has("ARCHITECTURE")).toBe(false);
      expect(pendingTypes.size).toBe(0);
    });

    it("should show pending when latest run has null decision", () => {
      const runs = [
        {
          type: "REQUIREMENTS" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "REQUIREMENTS" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-01-01"), // Older accepted run
        },
      ];

      const pendingTypes = computePendingRunTypes(runs);

      // Should include REQUIREMENTS because the latest run is pending
      expect(pendingTypes.has("REQUIREMENTS")).toBe(true);
      expect(pendingTypes.size).toBe(1);
    });

    it("should handle mixed states across different types", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "REQUIREMENTS" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "TASK_GENERATION" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-02-02"),
        },
        {
          type: "TASK_GENERATION" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"), // Older pending run
        },
        {
          type: "USER_STORIES" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
      ];

      const pendingTypes = computePendingRunTypes(runs);

      // Only REQUIREMENTS and USER_STORIES should be pending
      expect(pendingTypes.has("ARCHITECTURE")).toBe(false);
      expect(pendingTypes.has("REQUIREMENTS")).toBe(true);
      expect(pendingTypes.has("TASK_GENERATION")).toBe(false);
      expect(pendingTypes.has("USER_STORIES")).toBe(true);
      expect(pendingTypes.size).toBe(2);
    });

    it("should exclude TASK_GENERATION when tasks exist", () => {
      const runs = [
        {
          type: "TASK_GENERATION" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
      ];

      const pendingTypesWithTasks = computePendingRunTypes(runs, true);
      const pendingTypesWithoutTasks = computePendingRunTypes(runs, false);

      // Should NOT show TASK_GENERATION when tasks exist
      expect(pendingTypesWithTasks.has("TASK_GENERATION")).toBe(false);
      expect(pendingTypesWithTasks.size).toBe(0);

      // Should show TASK_GENERATION when no tasks exist
      expect(pendingTypesWithoutTasks.has("TASK_GENERATION")).toBe(true);
      expect(pendingTypesWithoutTasks.size).toBe(1);
    });

    it("should handle rejected decisions same as accepted", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: "REJECTED",
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-01-01"),
        },
      ];

      const pendingTypes = computePendingRunTypes(runs);

      // Should NOT show pending because latest run is REJECTED
      expect(pendingTypes.has("ARCHITECTURE")).toBe(false);
      expect(pendingTypes.size).toBe(0);
    });

    it("should ignore POD_REPAIR and POD_LAUNCH_FAILURE types", () => {
      const runs = [
        {
          type: "POD_REPAIR" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "POD_LAUNCH_FAILURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
      ];

      const pendingTypes = computePendingRunTypes(runs);

      // Only ARCHITECTURE should be considered
      expect(pendingTypes.has("POD_REPAIR")).toBe(false);
      expect(pendingTypes.has("POD_LAUNCH_FAILURE")).toBe(false);
      expect(pendingTypes.has("ARCHITECTURE")).toBe(true);
      expect(pendingTypes.size).toBe(1);
    });

    it("should handle empty runs array", () => {
      const runs: Array<{ type: StakworkRunType; decision: string | null; createdAt: Date }> = [];

      const pendingTypes = computePendingRunTypes(runs);

      expect(pendingTypes.size).toBe(0);
    });

    it("should handle multiple runs of same type with same timestamp", () => {
      const sameDate = new Date("2024-02-01");
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: sameDate,
        },
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: sameDate,
        },
      ];

      const pendingTypes = computePendingRunTypes(runs);

      // First run in array should be taken (ACCEPTED)
      expect(pendingTypes.has("ARCHITECTURE")).toBe(false);
      expect(pendingTypes.size).toBe(0);
    });
  });

  describe("computePendingCount", () => {
    it("should count number of types with pending latest runs", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "REQUIREMENTS" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "TASK_GENERATION" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-02-01"),
        },
      ];

      const count = computePendingCount(runs);

      // 2 types have pending latest runs
      expect(count).toBe(2);
    });

    it("should return 0 when no runs are pending", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "REQUIREMENTS" as StakworkRunType,
          decision: "REJECTED",
          createdAt: new Date("2024-02-01"),
        },
      ];

      const count = computePendingCount(runs);

      expect(count).toBe(0);
    });

    it("should only count latest run per type", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: "ACCEPTED",
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-01-01"), // Older pending
        },
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-01-15"), // Another old pending
        },
      ];

      const count = computePendingCount(runs);

      // Should be 0 because latest is ACCEPTED
      expect(count).toBe(0);
    });

    it("should count all types when multiple have pending latest runs", () => {
      const runs = [
        {
          type: "ARCHITECTURE" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "REQUIREMENTS" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "TASK_GENERATION" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
        {
          type: "USER_STORIES" as StakworkRunType,
          decision: null,
          createdAt: new Date("2024-02-01"),
        },
      ];

      const count = computePendingCount(runs);

      // All 4 types have pending runs
      expect(count).toBe(4);
    });

    it("should handle empty runs array", () => {
      const runs: Array<{ type: StakworkRunType; decision: string | null; createdAt: Date }> = [];

      const count = computePendingCount(runs);

      expect(count).toBe(0);
    });
  });
});
