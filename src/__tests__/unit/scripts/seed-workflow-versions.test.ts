/**
 * Unit tests for workflow version seed script data generation
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

// Test data generation functions (extracted from seed script for testing)
function generateWorkflowJson(workflowId: number, versionNumber: number): string {
  const workflow = {
    nodes: [
      {
        id: `node-${randomUUID()}`,
        type: "start",
        position: { x: 100, y: 100 },
        data: { label: "Start" },
      },
      {
        id: `node-${randomUUID()}`,
        type: "task",
        position: { x: 300, y: 100 },
        data: { label: `Task ${versionNumber}`, description: `Version ${versionNumber} task` },
      },
      {
        id: `node-${randomUUID()}`,
        type: "decision",
        position: { x: 500, y: 100 },
        data: { label: "Decision Point", condition: "status === 'approved'" },
      },
      {
        id: `node-${randomUUID()}`,
        type: "end",
        position: { x: 700, y: 100 },
        data: { label: "End" },
      },
    ],
    edges: [
      { id: `edge-${randomUUID()}`, source: "node-1", target: "node-2" },
      { id: `edge-${randomUUID()}`, source: "node-2", target: "node-3" },
      { id: `edge-${randomUUID()}`, source: "node-3", target: "node-4", label: "approved" },
    ],
    version: versionNumber,
    workflowId: workflowId,
  };

  return JSON.stringify(workflow);
}

interface WorkflowVersionNode {
  workflow_version_id: string;
  workflow_id: number;
  workflow_json: string;
  date_added_to_graph: string;
  published_at: string | null;
  workflow_name: string;
  node_type: "Workflow_version";
}

function generateTestData(): WorkflowVersionNode[] {
  const versions: WorkflowVersionNode[] = [];
  const now = new Date();

  // Workflow 1: 12 versions (test 10-version limit)
  for (let i = 1; i <= 12; i++) {
    const daysAgo = 12 - i; // Newest first
    const createdDate = new Date(now);
    createdDate.setDate(createdDate.getDate() - daysAgo);

    const isPublished = i === 8 || i === 11;

    versions.push({
      workflow_version_id: randomUUID(),
      workflow_id: 1001,
      workflow_json: generateWorkflowJson(1001, i),
      date_added_to_graph: createdDate.toISOString(),
      published_at: isPublished ? createdDate.toISOString() : null,
      workflow_name: `Test Workflow Alpha v${i}`,
      node_type: "Workflow_version",
    });
  }

  // Workflow 2: 5 versions with mix of published/draft
  for (let i = 1; i <= 5; i++) {
    const daysAgo = (5 - i) * 2;
    const createdDate = new Date(now);
    createdDate.setDate(createdDate.getDate() - daysAgo);

    const isPublished = i === 3 || i === 5;

    versions.push({
      workflow_version_id: randomUUID(),
      workflow_id: 1002,
      workflow_json: generateWorkflowJson(1002, i),
      date_added_to_graph: createdDate.toISOString(),
      published_at: isPublished ? createdDate.toISOString() : null,
      workflow_name: `Test Workflow Beta v${i}`,
      node_type: "Workflow_version",
    });
  }

  // Workflow 3: 1 version (edge case)
  const singleVersionDate = new Date(now);
  singleVersionDate.setDate(singleVersionDate.getDate() - 1);

  versions.push({
    workflow_version_id: randomUUID(),
    workflow_id: 1003,
    workflow_json: generateWorkflowJson(1003, 1),
    date_added_to_graph: singleVersionDate.toISOString(),
    published_at: singleVersionDate.toISOString(),
    workflow_name: "Test Workflow Gamma v1",
    node_type: "Workflow_version",
  });

  return versions;
}

describe("Workflow Version Seed Script - Data Generation", () => {
  describe("generateWorkflowJson", () => {
    it("should generate valid JSON string", () => {
      const json = generateWorkflowJson(1001, 1);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should include workflow metadata", () => {
      const json = generateWorkflowJson(1001, 5);
      const workflow = JSON.parse(json);

      expect(workflow.workflowId).toBe(1001);
      expect(workflow.version).toBe(5);
    });

    it("should include nodes and edges", () => {
      const json = generateWorkflowJson(1001, 1);
      const workflow = JSON.parse(json);

      expect(workflow.nodes).toBeDefined();
      expect(workflow.nodes.length).toBe(4);
      expect(workflow.edges).toBeDefined();
      expect(workflow.edges.length).toBe(3);
    });

    it("should include version number in task label", () => {
      const json = generateWorkflowJson(1001, 7);
      const workflow = JSON.parse(json);

      const taskNode = workflow.nodes.find((n: { type: string }) => n.type === "task");
      expect(taskNode).toBeDefined();
      expect(taskNode.data.label).toContain("7");
      expect(taskNode.data.description).toContain("Version 7");
    });
  });

  describe("generateTestData", () => {
    it("should generate correct total number of versions", () => {
      const versions = generateTestData();
      expect(versions.length).toBe(18); // 12 + 5 + 1
    });

    it("should create three different workflow IDs", () => {
      const versions = generateTestData();
      const uniqueWorkflowIds = new Set(versions.map((v) => v.workflow_id));
      expect(uniqueWorkflowIds.size).toBe(3);
      expect(uniqueWorkflowIds.has(1001)).toBe(true);
      expect(uniqueWorkflowIds.has(1002)).toBe(true);
      expect(uniqueWorkflowIds.has(1003)).toBe(true);
    });

    it("should create 12 versions for workflow 1001", () => {
      const versions = generateTestData();
      const workflow1Versions = versions.filter((v) => v.workflow_id === 1001);
      expect(workflow1Versions.length).toBe(12);
    });

    it("should create 5 versions for workflow 1002", () => {
      const versions = generateTestData();
      const workflow2Versions = versions.filter((v) => v.workflow_id === 1002);
      expect(workflow2Versions.length).toBe(5);
    });

    it("should create 1 version for workflow 1003", () => {
      const versions = generateTestData();
      const workflow3Versions = versions.filter((v) => v.workflow_id === 1003);
      expect(workflow3Versions.length).toBe(1);
    });

    it("should generate unique workflow_version_ids", () => {
      const versions = generateTestData();
      const versionIds = versions.map((v) => v.workflow_version_id);
      const uniqueIds = new Set(versionIds);
      expect(uniqueIds.size).toBe(versions.length);
    });

    it("should use UUID format for workflow_version_id", () => {
      const versions = generateTestData();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      versions.forEach((version) => {
        expect(version.workflow_version_id).toMatch(uuidRegex);
      });
    });

    it("should set node_type to Workflow_version", () => {
      const versions = generateTestData();
      versions.forEach((version) => {
        expect(version.node_type).toBe("Workflow_version");
      });
    });

    it("should include workflow_name for all versions", () => {
      const versions = generateTestData();
      versions.forEach((version) => {
        expect(version.workflow_name).toBeDefined();
        expect(typeof version.workflow_name).toBe("string");
        expect(version.workflow_name.length).toBeGreaterThan(0);
      });
    });

    it("should have different creation dates for versions", () => {
      const versions = generateTestData();
      const workflow1Versions = versions.filter((v) => v.workflow_id === 1001);

      const dates = workflow1Versions.map((v) => new Date(v.date_added_to_graph).getTime());
      const uniqueDates = new Set(dates);

      expect(uniqueDates.size).toBeGreaterThan(1); // Not all the same date
    });

    it("should sort workflow 1001 versions in chronological order (oldest to newest)", () => {
      const versions = generateTestData();
      const workflow1Versions = versions.filter((v) => v.workflow_id === 1001);

      for (let i = 1; i < workflow1Versions.length; i++) {
        const prevDate = new Date(workflow1Versions[i - 1].date_added_to_graph);
        const currDate = new Date(workflow1Versions[i].date_added_to_graph);
        expect(currDate.getTime()).toBeGreaterThanOrEqual(prevDate.getTime());
      }
    });

    it("should mark exactly 2 versions as published for workflow 1001", () => {
      const versions = generateTestData();
      const workflow1Versions = versions.filter((v) => v.workflow_id === 1001);
      const publishedCount = workflow1Versions.filter((v) => v.published_at !== null).length;
      expect(publishedCount).toBe(2);
    });

    it("should mark exactly 2 versions as published for workflow 1002", () => {
      const versions = generateTestData();
      const workflow2Versions = versions.filter((v) => v.workflow_id === 1002);
      const publishedCount = workflow2Versions.filter((v) => v.published_at !== null).length;
      expect(publishedCount).toBe(2);
    });

    it("should mark the single version as published for workflow 1003", () => {
      const versions = generateTestData();
      const workflow3Versions = versions.filter((v) => v.workflow_id === 1003);
      expect(workflow3Versions[0].published_at).not.toBeNull();
    });

    it("should have valid ISO timestamp for date_added_to_graph", () => {
      const versions = generateTestData();
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

      versions.forEach((version) => {
        expect(version.date_added_to_graph).toMatch(isoRegex);
        expect(new Date(version.date_added_to_graph).toString()).not.toBe("Invalid Date");
      });
    });

    it("should have valid ISO timestamp for published_at when not null", () => {
      const versions = generateTestData();
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

      versions.forEach((version) => {
        if (version.published_at !== null) {
          expect(version.published_at).toMatch(isoRegex);
          expect(new Date(version.published_at).toString()).not.toBe("Invalid Date");
        }
      });
    });

    it("should have parseable workflow_json", () => {
      const versions = generateTestData();

      versions.forEach((version) => {
        expect(() => JSON.parse(version.workflow_json)).not.toThrow();
      });
    });

    it("should include workflowId in workflow_json", () => {
      const versions = generateTestData();

      versions.forEach((version) => {
        const workflow = JSON.parse(version.workflow_json);
        expect(workflow.workflowId).toBe(version.workflow_id);
      });
    });

    it("should have version increment reflected in workflow_name", () => {
      const versions = generateTestData();
      const workflow1Versions = versions.filter((v) => v.workflow_id === 1001);

      workflow1Versions.forEach((version, index) => {
        const versionNumber = index + 1;
        expect(version.workflow_name).toContain(`v${versionNumber}`);
      });
    });

    it("should spread workflow 2 versions over different dates", () => {
      const versions = generateTestData();
      const workflow2Versions = versions.filter((v) => v.workflow_id === 1002);

      const dates = workflow2Versions.map((v) => new Date(v.date_added_to_graph).getTime());

      // Check that consecutive versions have different dates
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThan(dates[i - 1]);
      }
    });

    it("should have workflow 3 version from yesterday", () => {
      const versions = generateTestData();
      const workflow3Version = versions.find((v) => v.workflow_id === 1003);

      if (!workflow3Version) {
        throw new Error("Workflow 1003 version not found");
      }

      const versionDate = new Date(workflow3Version.date_added_to_graph);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Should be approximately 1 day ago (within 2 hours tolerance for test timing)
      const diffHours = Math.abs(versionDate.getTime() - yesterday.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeLessThan(2);
    });
  });
});
