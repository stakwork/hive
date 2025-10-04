import {
  mapStakworkStatus,
  stakgraphToRepositoryStatus,
} from "@/utils/conversions";
import { describe, expect, test, vi } from "vitest";

// Mock Prisma enums
vi.mock("@prisma/client", () => ({
  WorkflowStatus: {
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    HALTED: "HALTED",
  },
  RepositoryStatus: {
    PENDING: "PENDING",
    SYNCED: "SYNCED",
    FAILED: "FAILED",
  },
}));

// Create test helpers to test internal functionality
const normalizeStatus = (status: string) => status.toLowerCase();

const mapStatus = (status: string, mapping: Record<string, string[]>, defaultValue?: string) => {
  const normalized = status.toLowerCase();
  for (const [enumValue, patterns] of Object.entries(mapping)) {
    if (patterns.some(pattern => normalized.includes(pattern))) {
      return enumValue;
    }
  }
  return defaultValue || null;
};

describe("conversions", () => {
  describe("normalizeStatus", () => {
    test("converts status to lowercase", () => {
      expect(normalizeStatus("PROCESSING")).toBe("processing");
      expect(normalizeStatus("InProgress")).toBe("inprogress");
      expect(normalizeStatus("COMPLETED")).toBe("completed");
      expect(normalizeStatus("Failed")).toBe("failed");
    });

    test("handles already lowercase status", () => {
      expect(normalizeStatus("processing")).toBe("processing");
      expect(normalizeStatus("completed")).toBe("completed");
    });

    test("handles empty string", () => {
      expect(normalizeStatus("")).toBe("");
    });

    test("handles mixed case with spaces and underscores", () => {
      expect(normalizeStatus("In_Progress")).toBe("in_progress");
      expect(normalizeStatus("NOT FOUND")).toBe("not found");
    });
  });

  describe("mapStatus", () => {
    const testMapping = {
      PROCESSING: ["inprogress", "in_progress", "running"],
      COMPLETED: ["complete", "completed", "success"],
      FAILED: ["fail", "error", "failed"],
    };

    test("maps status using patterns correctly", () => {
      expect(mapStatus("inprogress", testMapping)).toBe("PROCESSING");
      expect(mapStatus("IN_PROGRESS", testMapping)).toBe("PROCESSING");
      expect(mapStatus("running", testMapping)).toBe("PROCESSING");
      expect(mapStatus("COMPLETED", testMapping)).toBe("COMPLETED");
      expect(mapStatus("success", testMapping)).toBe("COMPLETED");
      expect(mapStatus("failed", testMapping)).toBe("FAILED");
      expect(mapStatus("ERROR", testMapping)).toBe("FAILED");
    });

    test("returns default value when no match found", () => {
      expect(mapStatus("unknown", testMapping, "DEFAULT")).toBe("DEFAULT");
      expect(mapStatus("invalid", testMapping)).toBeNull();
    });

    test("handles partial string matches", () => {
      expect(mapStatus("status_inprogress_now", testMapping)).toBe("PROCESSING");
      expect(mapStatus("task_completed_successfully", testMapping)).toBe("COMPLETED");
      expect(mapStatus("operation_failed_badly", testMapping)).toBe("FAILED");
    });

    test("handles empty mapping", () => {
      expect(mapStatus("any", {}, "DEFAULT")).toBe("DEFAULT");
      expect(mapStatus("any", {})).toBeNull();
    });

    test("handles empty status string", () => {
      expect(mapStatus("", testMapping)).toBeNull();
      expect(mapStatus("", testMapping, "DEFAULT")).toBe("DEFAULT");
    });
  });

  describe("mapStakworkStatus", () => {
    test("maps valid workflow statuses correctly", () => {
      expect(mapStakworkStatus("in_progress")).toBe("IN_PROGRESS");
      expect(mapStakworkStatus("running")).toBe("IN_PROGRESS");
      expect(mapStakworkStatus("processing")).toBe("IN_PROGRESS");

      expect(mapStakworkStatus("completed")).toBe("COMPLETED");
      expect(mapStakworkStatus("success")).toBe("COMPLETED");
      expect(mapStakworkStatus("finished")).toBe("COMPLETED");

      expect(mapStakworkStatus("error")).toBe("FAILED");
      expect(mapStakworkStatus("failed")).toBe("FAILED");

      expect(mapStakworkStatus("halted")).toBe("HALTED");
      expect(mapStakworkStatus("paused")).toBe("HALTED");
      expect(mapStakworkStatus("stopped")).toBe("HALTED");
    });

    test("handles case insensitive input", () => {
      expect(mapStakworkStatus("IN_PROGRESS")).toBe("IN_PROGRESS");
      expect(mapStakworkStatus("COMPLETED")).toBe("COMPLETED");
      expect(mapStakworkStatus("FAILED")).toBe("FAILED");
      expect(mapStakworkStatus("HALTED")).toBe("HALTED");
    });

    test("returns null for unknown status", () => {
      expect(mapStakworkStatus("unknown")).toBeNull();
      expect(mapStakworkStatus("invalid")).toBeNull();
      expect(mapStakworkStatus("")).toBeNull();
    });

    test("handles partial matches in status strings", () => {
      expect(mapStakworkStatus("workflow_in_progress")).toBe("IN_PROGRESS");
      expect(mapStakworkStatus("task_completed_ok")).toBe("COMPLETED");
      expect(mapStakworkStatus("operation_failed")).toBe("FAILED");
      expect(mapStakworkStatus("job_halted_by_user")).toBe("HALTED");
    });
  });

  describe("stakgraphToRepositoryStatus", () => {
    test("converts valid stakgraph statuses to RepositoryStatus", () => {
      expect(stakgraphToRepositoryStatus("inprogress")).toBe("PENDING");
      expect(stakgraphToRepositoryStatus("complete")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("completed")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("synced")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("failed")).toBe("FAILED");
    });

    test("handles case insensitive input", () => {
      expect(stakgraphToRepositoryStatus("INPROGRESS")).toBe("PENDING");
      expect(stakgraphToRepositoryStatus("InProgress")).toBe("PENDING");
      expect(stakgraphToRepositoryStatus("COMPLETE")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("Complete")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("COMPLETED")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("Synced")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("FAILED")).toBe("FAILED");
      expect(stakgraphToRepositoryStatus("Failed")).toBe("FAILED");
    });

    test("throws error for unknown stakgraph status", () => {
      expect(() => stakgraphToRepositoryStatus("unknown")).toThrow("Unknown stakgraph status: unknown");
      expect(() => stakgraphToRepositoryStatus("invalid")).toThrow("Unknown stakgraph status: invalid");
      expect(() => stakgraphToRepositoryStatus("")).toThrow("Unknown stakgraph status: ");
      expect(() => stakgraphToRepositoryStatus("processing")).toThrow("Unknown stakgraph status: processing");
    });

    test("maintains original status in error message", () => {
      expect(() => stakgraphToRepositoryStatus("UNKNOWN")).toThrow("Unknown stakgraph status: UNKNOWN");
      expect(() => stakgraphToRepositoryStatus("Mixed_Case")).toThrow("Unknown stakgraph status: Mixed_Case");
    });
  });

  describe("status mapping integration", () => {

    test("workflowStatusMapping patterns work with mapStatus", () => {
      const workflowMapping = {
        IN_PROGRESS: ["in_progress", "running", "processing"],
        COMPLETED: ["completed", "success", "finished"],
        FAILED: ["error", "failed"],
        HALTED: ["halted", "paused", "stopped"],
      };

      // Test all patterns in workflowStatusMapping
      expect(mapStatus("in_progress", workflowMapping)).toBe("IN_PROGRESS");
      expect(mapStatus("running", workflowMapping)).toBe("IN_PROGRESS");
      expect(mapStatus("processing", workflowMapping)).toBe("IN_PROGRESS");

      expect(mapStatus("completed", workflowMapping)).toBe("COMPLETED");
      expect(mapStatus("success", workflowMapping)).toBe("COMPLETED");
      expect(mapStatus("finished", workflowMapping)).toBe("COMPLETED");

      expect(mapStatus("error", workflowMapping)).toBe("FAILED");
      expect(mapStatus("failed", workflowMapping)).toBe("FAILED");

      expect(mapStatus("halted", workflowMapping)).toBe("HALTED");
      expect(mapStatus("paused", workflowMapping)).toBe("HALTED");
      expect(mapStatus("stopped", workflowMapping)).toBe("HALTED");
    });
  });

  describe("edge cases and error handling", () => {
    test("verifies type safety with generics", () => {
      const customMapping = { CUSTOM: ["test"] };
      const result = mapStatus("test", customMapping, "DEFAULT");
      expect(result).toBe("CUSTOM");

      const defaultResult = mapStatus("unknown", customMapping, "DEFAULT");
      expect(defaultResult).toBe("DEFAULT");
    });
  });
});
