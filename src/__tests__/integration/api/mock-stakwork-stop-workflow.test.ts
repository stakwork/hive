import { describe, test, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/mock/stakwork/projects/[projectId]/stop/route";
import { mockStakworkState } from "@/lib/mock/stakwork-state";
import { NextRequest } from "next/server";

describe("POST /api/mock/stakwork/projects/[projectId]/stop - Integration Tests", () => {
  beforeEach(() => {
    // Reset mock state before each test
    mockStakworkState.reset();
  });

  describe("Successful workflow stop", () => {
    test("should stop a running workflow", async () => {
      // Create a test project
      const { project_id } = mockStakworkState.createProject({
        name: "Test Project",
        workflow_id: 123,
        workflow_params: {},
      });

      // Start the workflow
      mockStakworkState.progressWorkflow(project_id);

      // Verify it's running
      let project = mockStakworkState.getProject(project_id);
      expect(project?.workflow_state).toBe("running");

      // Stop the workflow
      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        message: "Workflow stopped",
      });

      // Verify workflow state changed
      project = mockStakworkState.getProject(project_id);
      expect(project?.workflow_state).toBe("complete");
    });

    test("should stop a pending workflow", async () => {
      const { project_id } = mockStakworkState.createProject({
        name: "Pending Project",
        workflow_id: 456,
        workflow_params: {},
      });

      // Project is pending by default
      let project = mockStakworkState.getProject(project_id);
      expect(project?.workflow_state).toBe("pending");

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });

      expect(response.status).toBe(200);

      project = mockStakworkState.getProject(project_id);
      expect(project?.workflow_state).toBe("complete");
    });

    test("should handle already completed workflow gracefully", async () => {
      const { project_id } = mockStakworkState.createProject({
        name: "Completed Project",
        workflow_id: 789,
        workflow_params: {},
      });

      // Manually set to complete
      const project = mockStakworkState.getProject(project_id);
      if (project) {
        project.workflow_state = "complete";
      }

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should clear completion timer for running workflow", async () => {
      const { project_id } = mockStakworkState.createProject({
        name: "Timer Project",
        workflow_id: 999,
        workflow_params: {},
      });

      // Start workflow (sets timer)
      mockStakworkState.progressWorkflow(project_id);

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });

      expect(response.status).toBe(200);

      // Wait to ensure timer doesn't fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      const project = mockStakworkState.getProject(project_id);
      expect(project?.workflow_state).toBe("complete");
      expect(project?.completionTimer).toBeUndefined();
    });
  });

  describe("Error handling", () => {
    test("should return 404 for non-existent project", async () => {
      const nonExistentId = 99999;

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${nonExistentId}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: nonExistentId.toString() }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        success: false,
        error: "Project not found",
      });
    });

    test("should handle invalid project ID format", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/invalid/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: "invalid" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe("State management", () => {
    test("should not affect other projects when stopping one", async () => {
      // Create multiple projects
      const { project_id: project1 } = mockStakworkState.createProject({
        name: "Project 1",
        workflow_id: 100,
        workflow_params: {},
      });
      const { project_id: project2 } = mockStakworkState.createProject({
        name: "Project 2",
        workflow_id: 200,
        workflow_params: {},
      });

      // Start both
      mockStakworkState.progressWorkflow(project1);
      mockStakworkState.progressWorkflow(project2);

      // Stop only project1
      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project1}/stop`,
        { method: "POST" }
      );

      await POST(request, {
        params: Promise.resolve({ projectId: project1.toString() }),
      });

      // Verify project1 stopped
      const project1State = mockStakworkState.getProject(project1);
      expect(project1State?.workflow_state).toBe("complete");

      // Verify project2 still running
      const project2State = mockStakworkState.getProject(project2);
      expect(project2State?.workflow_state).toBe("running");
    });

    test("should allow multiple stop calls on same project", async () => {
      const { project_id } = mockStakworkState.createProject({
        name: "Multi-stop Project",
        workflow_id: 300,
        workflow_params: {},
      });

      mockStakworkState.progressWorkflow(project_id);

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      // First stop
      const response1 = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });
      expect(response1.status).toBe(200);

      // Second stop (idempotent)
      const response2 = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });
      expect(response2.status).toBe(200);

      const project = mockStakworkState.getProject(project_id);
      expect(project?.workflow_state).toBe("complete");
    });
  });

  describe("Response format", () => {
    test("should return correct content-type header", async () => {
      const { project_id } = mockStakworkState.createProject({
        name: "Content Type Project",
        workflow_id: 400,
        workflow_params: {},
      });

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });

      expect(response.headers.get("content-type")).toContain("application/json");
    });

    test("should return proper JSON structure on success", async () => {
      const { project_id } = mockStakworkState.createProject({
        name: "JSON Structure Project",
        workflow_id: 500,
        workflow_params: {},
      });

      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/${project_id}/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: project_id.toString() }),
      });

      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(typeof data.success).toBe("boolean");
      expect(typeof data.message).toBe("string");
    });

    test("should return proper JSON structure on error", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/mock/stakwork/projects/99999/stop`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ projectId: "99999" }),
      });

      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("error");
      expect(data.success).toBe(false);
      expect(typeof data.error).toBe("string");
    });
  });
});
