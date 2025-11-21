import { describe, test, expect } from "vitest";
import { checkGooseRunning } from "@/lib/pods/utils";
import {
  type ProcessInfo,
  createMockGooseProcess,
  createMockFrontendProcess,
  createMockProcess,
} from "@/__tests__/support/helpers/pod-helpers";

describe("checkGooseRunning", () => {
  describe("when process list is empty", () => {
    test("returns false", () => {
      const emptyProcessList: ProcessInfo[] = [];

      const result = checkGooseRunning(emptyProcessList);

      expect(result).toBe(false);
    });
  });

  describe("when process list contains goose process", () => {
    test("returns true for single goose process", () => {
      const processList: ProcessInfo[] = [createMockGooseProcess()];

      const result = checkGooseRunning(processList);

      expect(result).toBe(true);
    });

    test("returns true when goose is among multiple processes", () => {
      const processList: ProcessInfo[] = [
        createMockFrontendProcess(),
        createMockGooseProcess(),
        createMockProcess({ pid: 9012, name: "backend", port: "8080", cwd: "/workspace/backend" }),
      ];

      const result = checkGooseRunning(processList);

      expect(result).toBe(true);
    });

    test("returns true regardless of goose process status", () => {
      const processList: ProcessInfo[] = [createMockGooseProcess({ status: "stopped", pm_uptime: 0 })];

      const result = checkGooseRunning(processList);

      expect(result).toBe(true);
    });

    test("returns true for first goose process when duplicates exist", () => {
      const processList: ProcessInfo[] = [createMockGooseProcess(), createMockGooseProcess({ pid: 5679 })];

      const result = checkGooseRunning(processList);

      expect(result).toBe(true);
    });
  });

  describe("when process list does not contain goose process", () => {
    test("returns false for single non-goose process", () => {
      const processList: ProcessInfo[] = [createMockFrontendProcess()];

      const result = checkGooseRunning(processList);

      expect(result).toBe(false);
    });

    test("returns false for multiple non-goose processes", () => {
      const processList: ProcessInfo[] = [
        createMockFrontendProcess(),
        createMockProcess({ pid: 9012, name: "backend", port: "8080", cwd: "/workspace/backend" }),
        createMockProcess({ pid: 3456, name: "database", port: "5432", cwd: "/workspace/db" }),
      ];

      const result = checkGooseRunning(processList);

      expect(result).toBe(false);
    });

    test("returns false for process with similar but non-matching name", () => {
      const processList: ProcessInfo[] = [
        createMockProcess({ pid: 5678, name: "goose-server", port: "15551", cwd: "/workspace/goose" }),
        createMockProcess({ pid: 5679, name: "my-goose", port: "15552", cwd: "/workspace/goose" }),
      ];

      const result = checkGooseRunning(processList);

      expect(result).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("returns false when process has empty name string", () => {
      const processList: ProcessInfo[] = [createMockProcess({ pid: 5678, name: "", port: "15551" })];

      const result = checkGooseRunning(processList);

      expect(result).toBe(false);
    });

    test("handles process with all required fields correctly", () => {
      const processList: ProcessInfo[] = [createMockGooseProcess()];

      const result = checkGooseRunning(processList);

      expect(result).toBe(true);
    });

    test("is case-sensitive for process name matching", () => {
      const processList: ProcessInfo[] = [
        createMockProcess({ pid: 5678, name: "GOOSE", port: "15551" }),
        createMockProcess({ pid: 5679, name: "Goose", port: "15551" }),
      ];

      const result = checkGooseRunning(processList);

      expect(result).toBe(false);
    });
  });
});
