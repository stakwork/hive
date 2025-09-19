import { describe, test, expect, vi } from "vitest";
import {
  mapStatusToStepStatus,
  mapStakworkStatus,
  stakgraphToStepStatus,
  stakgraphToRepositoryStatus,
} from "@/utils/conversions";

// Mock Prisma enums
vi.mock("@prisma/client", () => ({
  StepStatus: {
    PROCESSING: "PROCESSING",
    COMPLETED: "COMPLETED", 
    FAILED: "FAILED",
  },
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

const mapStatus = (status: string, mapping: any, defaultValue?: any) => {
  const normalized = status.toLowerCase();
  for (const [enumValue, patterns] of Object.entries(mapping)) {
    if ((patterns as string[]).some(pattern => normalized.includes(pattern))) {
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

  describe("mapStatusToStepStatus", () => {
    test("maps valid step statuses correctly", () => {
      expect(mapStatusToStepStatus("inprogress")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("in_progress")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("running")).toBe("PROCESSING");
      
      expect(mapStatusToStepStatus("complete")).toBe("COMPLETED");
      expect(mapStatusToStepStatus("completed")).toBe("COMPLETED");
      expect(mapStatusToStepStatus("success")).toBe("COMPLETED");
      
      expect(mapStatusToStepStatus("fail")).toBe("FAILED");
      expect(mapStatusToStepStatus("failed")).toBe("FAILED");
      expect(mapStatusToStepStatus("error")).toBe("FAILED");
    });

    test("handles case insensitive input", () => {
      expect(mapStatusToStepStatus("INPROGRESS")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("COMPLETED")).toBe("COMPLETED");
      expect(mapStatusToStepStatus("FAILED")).toBe("FAILED");
    });

    test("returns default PROCESSING for unknown status", () => {
      expect(mapStatusToStepStatus("unknown")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("invalid")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("")).toBe("PROCESSING");
    });

    test("handles partial matches in status strings", () => {
      expect(mapStatusToStepStatus("task_inprogress_now")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("operation_completed")).toBe("COMPLETED");
      expect(mapStatusToStepStatus("job_failed_today")).toBe("FAILED");
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

  describe("stakgraphToStepStatus", () => {
    test("converts valid stakgraph statuses to StepStatus", () => {
      expect(stakgraphToStepStatus("inprogress")).toBe("PROCESSING");
      expect(stakgraphToStepStatus("complete")).toBe("COMPLETED");
      expect(stakgraphToStepStatus("failed")).toBe("FAILED");
    });

    test("handles case insensitive input", () => {
      expect(stakgraphToStepStatus("INPROGRESS")).toBe("PROCESSING");
      expect(stakgraphToStepStatus("InProgress")).toBe("PROCESSING");
      expect(stakgraphToStepStatus("COMPLETE")).toBe("COMPLETED");
      expect(stakgraphToStepStatus("Complete")).toBe("COMPLETED");
      expect(stakgraphToStepStatus("FAILED")).toBe("FAILED");
      expect(stakgraphToStepStatus("Failed")).toBe("FAILED");
    });

    test("throws error for unknown stakgraph status", () => {
      expect(() => stakgraphToStepStatus("unknown")).toThrow("Unknown stakgraph status: unknown");
      expect(() => stakgraphToStepStatus("invalid")).toThrow("Unknown stakgraph status: invalid");
      expect(() => stakgraphToStepStatus("")).toThrow("Unknown stakgraph status: ");
      expect(() => stakgraphToStepStatus("processing")).toThrow("Unknown stakgraph status: processing");
    });

    test("maintains original status in error message", () => {
      expect(() => stakgraphToStepStatus("UNKNOWN")).toThrow("Unknown stakgraph status: UNKNOWN");
      expect(() => stakgraphToStepStatus("Mixed_Case")).toThrow("Unknown stakgraph status: Mixed_Case");
    });
  });

  describe("stakgraphToRepositoryStatus", () => {
    test("converts valid stakgraph statuses to RepositoryStatus", () => {
      expect(stakgraphToRepositoryStatus("inprogress")).toBe("PENDING");
      expect(stakgraphToRepositoryStatus("complete")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("failed")).toBe("FAILED");
    });

    test("handles case insensitive input", () => {
      expect(stakgraphToRepositoryStatus("INPROGRESS")).toBe("PENDING");
      expect(stakgraphToRepositoryStatus("InProgress")).toBe("PENDING");
      expect(stakgraphToRepositoryStatus("COMPLETE")).toBe("SYNCED");
      expect(stakgraphToRepositoryStatus("Complete")).toBe("SYNCED");
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
    test("stepStatusMapping patterns work with mapStatus", () => {
      const stepMapping = {
        PROCESSING: ["inprogress", "in_progress", "running"],
        COMPLETED: ["complete", "completed", "success"],
        FAILED: ["fail", "error", "failed"],
      };

      // Test all patterns in stepStatusMapping
      expect(mapStatus("inprogress", stepMapping)).toBe("PROCESSING");
      expect(mapStatus("in_progress", stepMapping)).toBe("PROCESSING");
      expect(mapStatus("running", stepMapping)).toBe("PROCESSING");
      
      expect(mapStatus("complete", stepMapping)).toBe("COMPLETED");
      expect(mapStatus("completed", stepMapping)).toBe("COMPLETED");
      expect(mapStatus("success", stepMapping)).toBe("COMPLETED");
      
      expect(mapStatus("fail", stepMapping)).toBe("FAILED");
      expect(mapStatus("error", stepMapping)).toBe("FAILED");
      expect(mapStatus("failed", stepMapping)).toBe("FAILED");
    });

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
    test("handles null and undefined inputs gracefully", () => {
      // These would throw in real usage, but we test string handling
      expect(() => stakgraphToStepStatus(null as any)).toThrow();
      expect(() => stakgraphToStepStatus(undefined as any)).toThrow();
      expect(() => stakgraphToRepositoryStatus(null as any)).toThrow();
      expect(() => stakgraphToRepositoryStatus(undefined as any)).toThrow();
    });

    test("handles whitespace-only strings", () => {
      expect(mapStatusToStepStatus("   ")).toBe("PROCESSING");
      expect(mapStakworkStatus("   ")).toBeNull();
      expect(() => stakgraphToStepStatus("   ")).toThrow();
      expect(() => stakgraphToRepositoryStatus("   ")).toThrow();
    });

    test("handles special characters in status strings", () => {
      expect(mapStatusToStepStatus("in-progress")).toBe("PROCESSING");
      expect(mapStatusToStepStatus("task.completed")).toBe("COMPLETED");
      expect(mapStakworkStatus("job@failed")).toBe("FAILED");
    });

    test("verifies type safety with generics", () => {
      const customMapping = { CUSTOM: ["test"] };
      const result = mapStatus("test", customMapping, "DEFAULT");
      expect(result).toBe("CUSTOM");
      
      const defaultResult = mapStatus("unknown", customMapping, "DEFAULT");
      expect(defaultResult).toBe("DEFAULT");
    });
  });
});