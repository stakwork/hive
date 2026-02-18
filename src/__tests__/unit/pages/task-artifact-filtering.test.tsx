import { describe, it, expect } from "vitest";

/**
 * Unit tests for artifact filtering logic in task page
 * Tests the filtering of WORKFLOW artifacts based on taskMode
 */

type ArtifactType = "WORKFLOW" | "BROWSER" | "CODE" | "DIFF" | "FORM" | "IDE";
type TaskMode = "agent" | "workflow_editor" | "project_debugger";

interface Artifact {
  id: string;
  type: ArtifactType;
  content: string;
}

/**
 * Simulates the artifact filtering logic from page.tsx
 */
function filterArtifacts(
  artifacts: Artifact[],
  taskMode: TaskMode,
  latestDiffArtifact?: Artifact
): Artifact[] {
  return artifacts.filter((a) => {
    if (a.type === "DIFF") {
      return a === latestDiffArtifact; // Only keep the latest diff
    }
    // Filter out WORKFLOW artifacts in agent mode
    // Agent mode shows only BROWSER/IDE/CODE/DIFF artifacts
    // WORKFLOW artifacts only relevant for workflow_editor and project_debugger modes
    if (a.type === "WORKFLOW" && taskMode === "agent") {
      return false;
    }
    return true; // Keep all other artifact types
  });
}

describe("Task Artifact Filtering", () => {
  describe("Agent Mode", () => {
    it("should filter out WORKFLOW artifacts when taskMode is 'agent'", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow data" },
        { id: "2", type: "BROWSER", content: "browser view" },
        { id: "3", type: "CODE", content: "code content" },
      ];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(2);
      expect(filtered.find((a) => a.type === "WORKFLOW")).toBeUndefined();
      expect(filtered.find((a) => a.type === "BROWSER")).toBeDefined();
      expect(filtered.find((a) => a.type === "CODE")).toBeDefined();
    });

    it("should keep BROWSER artifacts in agent mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "BROWSER", content: "browser view" },
        { id: "2", type: "WORKFLOW", content: "workflow data" },
      ];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe("BROWSER");
    });

    it("should keep CODE artifacts in agent mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "CODE", content: "code content" },
        { id: "2", type: "WORKFLOW", content: "workflow data" },
      ];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe("CODE");
    });

    it("should keep DIFF artifacts in agent mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "DIFF", content: "diff content" },
        { id: "2", type: "WORKFLOW", content: "workflow data" },
      ];
      const latestDiff = artifacts[0];

      const filtered = filterArtifacts(artifacts, "agent", latestDiff);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe("DIFF");
    });

    it("should keep IDE artifacts in agent mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "IDE", content: "ide content" },
        { id: "2", type: "WORKFLOW", content: "workflow data" },
      ];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe("IDE");
    });
  });

  describe("Workflow Editor Mode", () => {
    it("should keep WORKFLOW artifacts when taskMode is 'workflow_editor'", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow data" },
        { id: "2", type: "BROWSER", content: "browser view" },
      ];

      const filtered = filterArtifacts(artifacts, "workflow_editor");

      expect(filtered).toHaveLength(2);
      expect(filtered.find((a) => a.type === "WORKFLOW")).toBeDefined();
      expect(filtered.find((a) => a.type === "BROWSER")).toBeDefined();
    });

    it("should keep all artifact types in workflow_editor mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow data" },
        { id: "2", type: "BROWSER", content: "browser view" },
        { id: "3", type: "CODE", content: "code content" },
        { id: "4", type: "FORM", content: "form data" },
      ];

      const filtered = filterArtifacts(artifacts, "workflow_editor");

      expect(filtered).toHaveLength(4);
    });
  });

  describe("Project Debugger Mode", () => {
    it("should keep WORKFLOW artifacts when taskMode is 'project_debugger'", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow data" },
        { id: "2", type: "BROWSER", content: "browser view" },
      ];

      const filtered = filterArtifacts(artifacts, "project_debugger");

      expect(filtered).toHaveLength(2);
      expect(filtered.find((a) => a.type === "WORKFLOW")).toBeDefined();
      expect(filtered.find((a) => a.type === "BROWSER")).toBeDefined();
    });

    it("should keep all artifact types in project_debugger mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow data" },
        { id: "2", type: "BROWSER", content: "browser view" },
        { id: "3", type: "CODE", content: "code content" },
      ];

      const filtered = filterArtifacts(artifacts, "project_debugger");

      expect(filtered).toHaveLength(3);
    });
  });

  describe("DIFF Artifact Filtering", () => {
    it("should only keep the latest DIFF artifact", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "DIFF", content: "old diff" },
        { id: "2", type: "DIFF", content: "newer diff" },
        { id: "3", type: "DIFF", content: "latest diff" },
        { id: "4", type: "CODE", content: "code content" },
      ];
      const latestDiff = artifacts[2]; // The latest one

      const filtered = filterArtifacts(artifacts, "agent", latestDiff);

      const diffArtifacts = filtered.filter((a) => a.type === "DIFF");
      expect(diffArtifacts).toHaveLength(1);
      expect(diffArtifacts[0].id).toBe("3");
      expect(diffArtifacts[0].content).toBe("latest diff");
    });

    it("should preserve DIFF filtering across all task modes", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "DIFF", content: "old diff" },
        { id: "2", type: "DIFF", content: "latest diff" },
      ];
      const latestDiff = artifacts[1];

      const modes: TaskMode[] = ["agent", "workflow_editor", "project_debugger"];

      modes.forEach((mode) => {
        const filtered = filterArtifacts(artifacts, mode, latestDiff);
        const diffArtifacts = filtered.filter((a) => a.type === "DIFF");
        expect(diffArtifacts).toHaveLength(1);
        expect(diffArtifacts[0].id).toBe("2");
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty artifact array", () => {
      const artifacts: Artifact[] = [];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(0);
    });

    it("should handle artifacts with only WORKFLOW type in agent mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow 1" },
        { id: "2", type: "WORKFLOW", content: "workflow 2" },
      ];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(0);
    });

    it("should handle mixed artifacts in agent mode", () => {
      const artifacts: Artifact[] = [
        { id: "1", type: "WORKFLOW", content: "workflow data" },
        { id: "2", type: "BROWSER", content: "browser view" },
        { id: "3", type: "WORKFLOW", content: "more workflow" },
        { id: "4", type: "CODE", content: "code content" },
        { id: "5", type: "WORKFLOW", content: "yet more workflow" },
      ];

      const filtered = filterArtifacts(artifacts, "agent");

      expect(filtered).toHaveLength(2);
      expect(filtered.every((a) => a.type !== "WORKFLOW")).toBe(true);
    });
  });
});
