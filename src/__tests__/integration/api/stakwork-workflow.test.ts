import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/stakwork/workflow/[projectId]/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { stakworkService } from "@/lib/service-factory";
import { NextRequest } from "next/server";

// Mock the stakwork service
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(),
}));

describe("GET /api/stakwork/workflow/[projectId] - Integration Tests", () => {
  let mockStakworkService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock for stakworkService
    mockStakworkService = {
      getWorkflowData: vi.fn(),
    };
    vi.mocked(stakworkService).mockReturnValue(mockStakworkService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      await expectUnauthorized(response);
      expect(mockStakworkService.getWorkflowData).not.toHaveBeenCalled();
    });

    test("should call service with valid session even without userId", async () => {
      // Note: The route only checks session?.user, not session.user.id
      // This allows requests with sessions that have user but no user.id
      getMockedSession().mockResolvedValue({
        user: { name: "Test" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
          project: { workflow_state: "pending" },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      // Route allows request through since it only checks session?.user
      await expectSuccess(response, 200);
      expect(mockStakworkService.getWorkflowData).toHaveBeenCalledWith("12345");
    });
  });

  describe("Parameter Validation", () => {
    test("should return 400 for missing projectId parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "" });

      const response = await GET(request, { params });

      await expectError(response, "Missing required parameter: projectId", 400);
      expect(mockStakworkService.getWorkflowData).not.toHaveBeenCalled();
    });

    test("should return 400 for undefined projectId", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/undefined",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: undefined as any });

      const response = await GET(request, { params });

      await expectError(response, "Missing required parameter: projectId", 400);
      expect(mockStakworkService.getWorkflowData).not.toHaveBeenCalled();
    });

    test("should accept valid numeric projectId", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          stakworkProjectId: 12345,
          status: "TODO",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
          project: { workflow_state: "pending" },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      await expectSuccess(response, 200);
      expect(mockStakworkService.getWorkflowData).toHaveBeenCalledWith("12345");
    });
  });

  describe("Successful Workflow Data Retrieval", () => {
    test("should successfully retrieve workflow data for valid projectId", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      // Create a task with stakworkProjectId
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          stakworkProjectId: 12345,
          status: "TODO",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock successful Stakwork API response
      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Start", status: "completed" },
            { id: "2", title: "Process", status: "in_progress" },
          ],
          connections: [{ from: "1", to: "2" }],
          project: {
            workflow_state: "in_progress",
          },
        },
        status: "in_progress",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toEqual(mockWorkflowData);
      expect(data.workflowData).toBeDefined();
      expect(data.status).toBe("in_progress");
      expect(data.workflowData.transitions).toHaveLength(2);
      expect(data.workflowData.connections).toHaveLength(1);

      // Verify Stakwork service was called correctly
      expect(mockStakworkService.getWorkflowData).toHaveBeenCalledTimes(1);
      expect(mockStakworkService.getWorkflowData).toHaveBeenCalledWith("12345");
    });

    test("should handle workflow data with empty transitions", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          stakworkProjectId: 67890,
          status: "TODO",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
          project: {
            workflow_state: "pending",
          },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/67890",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "67890" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);
      expect(data.workflowData.transitions).toEqual([]);
      expect(data.workflowData.connections).toEqual([]);
      expect(data.status).toBe("pending");
    });

    test("should handle completed workflow status", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          stakworkProjectId: 99999,
          status: "DONE",
          workflowStatus: "COMPLETED",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Start", status: "completed" },
            { id: "2", title: "End", status: "completed" },
          ],
          connections: [{ from: "1", to: "2" }],
          project: {
            workflow_state: "completed",
          },
        },
        status: "completed",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/99999",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "99999" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("completed");
      expect(
        data.workflowData.transitions.every(
          (t: any) => t.status === "completed"
        )
      ).toBe(true);
    });

    test("should handle workflow with complex transition structure", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Complex Workflow Task",
          workspaceId: workspace.id,
          stakworkProjectId: 88888,
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            {
              id: "step-1",
              title: "Initialize",
              position: { x: 100, y: 100 },
              status: "completed",
              metadata: { duration: "2s" },
            },
            {
              id: "step-2",
              title: "Validate",
              position: { x: 300, y: 100 },
              status: "completed",
              metadata: { duration: "1s" },
            },
            {
              id: "step-3",
              title: "Process",
              position: { x: 500, y: 100 },
              status: "in_progress",
              metadata: { progress: 45 },
            },
            {
              id: "step-4",
              title: "Finalize",
              position: { x: 700, y: 100 },
              status: "pending",
            },
          ],
          connections: [
            { from: "step-1", to: "step-2", type: "success" },
            { from: "step-2", to: "step-3", type: "success" },
            { from: "step-3", to: "step-4", type: "success" },
          ],
          project: {
            workflow_state: "in_progress",
            id: 88888,
            name: "Complex Workflow",
            startedAt: "2024-01-01T00:00:00Z",
          },
        },
        status: "in_progress",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/88888",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "88888" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);
      expect(data.workflowData.transitions).toHaveLength(4);
      expect(data.workflowData.connections).toHaveLength(3);
      expect(data.workflowData.project.name).toBe("Complex Workflow");
    });
  });

  describe("Error Handling", () => {
    test("should return 500 when Stakwork API fails", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock Stakwork API failure
      mockStakworkService.getWorkflowData.mockRejectedValue(
        new Error("Stakwork API error")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      await expectError(response, "Failed to fetch workflow data", 500);
    });

    test("should handle ApiError with specific status code", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock ApiError from Stakwork service
      const apiError = {
        message: "Project not found in Stakwork",
        status: 404,
        service: "stakwork",
        details: { projectId: "12345" },
      };

      mockStakworkService.getWorkflowData.mockRejectedValue(apiError);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toBe("Project not found in Stakwork");
      expect(data.service).toBe("stakwork");
      expect(data.details).toEqual({ projectId: "12345" });
    });

    test("should handle network timeout errors", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockStakworkService.getWorkflowData.mockRejectedValue(
        new Error("Network timeout")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      await expectError(response, "Failed to fetch workflow data", 500);
    });

    test("should handle malformed Stakwork API response", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock malformed response
      mockStakworkService.getWorkflowData.mockResolvedValue({
        invalid: "response",
      });

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      // Should still return 200 but with malformed data
      // (endpoint doesn't validate response structure)
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toEqual({ invalid: "response" });
    });

    test("should handle ApiError with 503 Service Unavailable", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Stakwork service temporarily unavailable",
        status: 503,
        service: "stakwork",
        code: "SERVICE_UNAVAILABLE",
      };

      mockStakworkService.getWorkflowData.mockRejectedValue(apiError);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/12345",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      const data = await response.json();
      expect(response.status).toBe(503);
      expect(data.error).toBe("Stakwork service temporarily unavailable");
      expect(data.service).toBe("stakwork");
      // Note: Route only returns error, service, and details - not code
      // The code property is not preserved in the response
    });
  });

  describe("Access Control & Data Isolation", () => {
    test("should allow workspace owner to access their project workflow", async () => {
      const owner = await createTestUser({
        email: `owner-${generateUniqueId()}@example.com`,
      });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Owner Workspace",
      });

      await db.task.create({
        data: {
          title: "Owner Task",
          workspaceId: workspace.id,
          stakworkProjectId: 11111,
          status: "TODO",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
          project: { workflow_state: "pending" },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/11111",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "11111" });

      const response = await GET(request, { params });

      await expectSuccess(response, 200);
    });

    test("should allow workspace member to access project workflow", async () => {
      const owner = await createTestUser({
        email: `owner-${generateUniqueId()}@example.com`,
      });
      const member = await createTestUser({
        email: `member-${generateUniqueId()}@example.com`,
      });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Shared Workspace",
      });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      await db.task.create({
        data: {
          title: "Shared Task",
          workspaceId: workspace.id,
          stakworkProjectId: 22222,
          status: "TODO",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
          project: { workflow_state: "pending" },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/22222",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "22222" });

      const response = await GET(request, { params });

      await expectSuccess(response, 200);
    });

    test("CRITICAL SECURITY GAP: should prevent non-workspace-member from accessing workflow (CURRENTLY FAILS)", async () => {
      const owner = await createTestUser({
        email: `owner-${generateUniqueId()}@example.com`,
      });
      const unauthorizedUser = await createTestUser({
        email: `unauthorized-${generateUniqueId()}@example.com`,
      });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Private Workspace",
      });

      await db.task.create({
        data: {
          title: "Private Task",
          workspaceId: workspace.id,
          stakworkProjectId: 33333,
          status: "TODO",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const mockWorkflowData = {
        workflowData: {
          transitions: [{ id: "1", title: "Sensitive Data" }],
          connections: [],
          project: { workflow_state: "pending" },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/33333",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "33333" });

      const response = await GET(request, { params });

      // EXPECTED: Should return 403 Forbidden
      // ACTUAL: Currently returns 200 with workflow data (SECURITY VULNERABILITY)
      // The endpoint does NOT validate workspace membership before fetching workflow data
      // Unlike other endpoints that use validateWorkspaceAccess() or validateWorkspaceAccessById(),
      // this endpoint only checks authentication (session exists) but not authorization

      const data = await response.json();
      expect(response.status).toBe(200); // This should be 403
      expect(data.workflowData).toBeDefined(); // Unauthorized user can see private data

      // TODO: Once access control is implemented, replace above assertions with:
      // await expectError(response, "Access denied", 403);
      // expect(mockStakworkService.getWorkflowData).not.toHaveBeenCalled();
    });

    test("CRITICAL SECURITY GAP: should enforce data isolation between different workspaces (CURRENTLY FAILS)", async () => {
      // Create two separate workspaces with different owners
      const ownerA = await createTestUser({
        email: `owner-a-${generateUniqueId()}@example.com`,
      });
      const ownerB = await createTestUser({
        email: `owner-b-${generateUniqueId()}@example.com`,
      });

      const workspaceA = await createTestWorkspace({
        ownerId: ownerA.id,
        name: "Workspace A",
      });
      const workspaceB = await createTestWorkspace({
        ownerId: ownerB.id,
        name: "Workspace B",
      });

      // Create tasks in both workspaces with sensitive data
      await db.task.create({
        data: {
          title: "Confidential Task A",
          workspaceId: workspaceA.id,
          stakworkProjectId: 44444,
          status: "TODO",
          createdById: ownerA.id,
          updatedById: ownerA.id,
        },
      });

      await db.task.create({
        data: {
          title: "Task B",
          workspaceId: workspaceB.id,
          stakworkProjectId: 55555,
          status: "TODO",
          createdById: ownerB.id,
          updatedById: ownerB.id,
        },
      });

      // Owner B tries to access Owner A's workflow
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerB));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Confidential Workflow Step" },
            { id: "2", title: "Secret Process" },
          ],
          connections: [{ from: "1", to: "2" }],
          project: { workflow_state: "in_progress" },
        },
        status: "in_progress",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/44444",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "44444" });

      const response = await GET(request, { params });

      // EXPECTED: Should return 403 for cross-workspace access attempt
      // ACTUAL: Currently returns 200 allowing data leak between workspaces
      const data = await response.json();
      expect(response.status).toBe(200); // Should be 403
      expect(data.workflowData.transitions[0].title).toBe(
        "Confidential Workflow Step"
      ); // Data leak!

      // TODO: Once workspace isolation is enforced, replace with:
      // await expectError(response, "Access denied", 403);
    });

    test("SECURITY GAP: unauthorized user can access workflow without knowing workspace context", async () => {
      const ownerA = await createTestUser({
        email: `owner-${generateUniqueId()}@example.com`,
      });
      const attackerUser = await createTestUser({
        email: `attacker-${generateUniqueId()}@example.com`,
      });

      const workspaceA = await createTestWorkspace({
        ownerId: ownerA.id,
        name: "Target Workspace",
      });

      await db.task.create({
        data: {
          title: "Sensitive Task",
          workspaceId: workspaceA.id,
          stakworkProjectId: 66666,
          status: "TODO",
          createdById: ownerA.id,
          updatedById: ownerA.id,
        },
      });

      // Attacker only needs to know the projectId (could be guessed or leaked)
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(attackerUser)
      );

      const mockWorkflowData = {
        workflowData: {
          transitions: [{ id: "1", title: "API Key Rotation" }],
          connections: [],
          project: { workflow_state: "pending" },
        },
        status: "pending",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/66666",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "66666" });

      const response = await GET(request, { params });

      // Attacker can access workflow data without workspace membership
      const data = await response.json();
      expect(response.status).toBe(200); // Should be 403
      expect(data.workflowData).toBeDefined();

      // This demonstrates that ANY authenticated user can access ANY projectId
      // without needing workspace membership or knowledge of workspace slug
    });
  });

  describe("Response Structure Validation", () => {
    test("should return workflow data with correct structure", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          stakworkProjectId: 77777,
          status: "TODO",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            {
              id: "step-1",
              title: "Initialize",
              position: { x: 100, y: 100 },
              status: "completed",
            },
            {
              id: "step-2",
              title: "Execute",
              position: { x: 300, y: 100 },
              status: "in_progress",
            },
          ],
          connections: [{ from: "step-1", to: "step-2", type: "success" }],
          project: {
            workflow_state: "in_progress",
            id: 77777,
            name: "Test Workflow",
          },
        },
        status: "in_progress",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/77777",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "77777" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);

      // Verify response has required top-level fields
      expect(data).toHaveProperty("workflowData");
      expect(data).toHaveProperty("status");

      // Verify workflowData structure
      expect(data.workflowData).toHaveProperty("transitions");
      expect(data.workflowData).toHaveProperty("connections");
      expect(data.workflowData).toHaveProperty("project");

      // Verify transitions array structure
      expect(Array.isArray(data.workflowData.transitions)).toBe(true);
      expect(data.workflowData.transitions[0]).toHaveProperty("id");
      expect(data.workflowData.transitions[0]).toHaveProperty("title");
      expect(data.workflowData.transitions[0]).toHaveProperty("status");

      // Verify connections array structure
      expect(Array.isArray(data.workflowData.connections)).toBe(true);
      expect(data.workflowData.connections[0]).toHaveProperty("from");
      expect(data.workflowData.connections[0]).toHaveProperty("to");

      // Verify project object
      expect(data.workflowData.project).toHaveProperty("workflow_state");
      expect(data.workflowData.project.workflow_state).toBe("in_progress");
    });

    test("should preserve all workflow metadata in response", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Metadata Task",
          workspaceId: workspace.id,
          stakworkProjectId: 88888,
          status: "TODO",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            {
              id: "step-1",
              title: "Start",
              status: "completed",
              metadata: {
                executionTime: 1500,
                retries: 0,
                customField: "value",
              },
            },
          ],
          connections: [],
          project: {
            workflow_state: "completed",
            createdBy: "user-123",
            startedAt: "2024-01-01T00:00:00Z",
            completedAt: "2024-01-01T00:05:00Z",
            customProjectData: { foo: "bar" },
          },
        },
        status: "completed",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/88888",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "88888" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);

      // Verify all metadata is preserved
      expect(data.workflowData.transitions[0].metadata).toEqual({
        executionTime: 1500,
        retries: 0,
        customField: "value",
      });
      expect(data.workflowData.project.customProjectData).toEqual({
        foo: "bar",
      });
      expect(data.workflowData.project.createdBy).toBe("user-123");
    });
  });

  describe("Integration with useWorkflowPolling hook", () => {
    test("should return data structure compatible with useWorkflowPolling hook", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Polling Test Task",
          workspaceId: workspace.id,
          stakworkProjectId: 99999,
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Step 1", status: "completed" },
            { id: "2", title: "Step 2", status: "in_progress" },
          ],
          connections: [{ from: "1", to: "2" }],
          project: {
            workflow_state: "in_progress",
          },
        },
        status: "in_progress",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/99999",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "99999" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);

      // Verify structure matches WorkflowData interface expected by useWorkflowPolling
      expect(data).toHaveProperty("workflowData");
      expect(data).toHaveProperty("status");
      expect(typeof data.status).toBe("string");
      expect(data.workflowData).toHaveProperty("transitions");
      expect(data.workflowData).toHaveProperty("connections");

      // Hook should be able to check for completion
      const isCompleted = data.status === "completed";
      expect(isCompleted).toBe(false);
    });

    test("should support polling stop condition when workflow is completed", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      await db.task.create({
        data: {
          title: "Completed Workflow Task",
          workspaceId: workspace.id,
          stakworkProjectId: 11111,
          status: "DONE",
          workflowStatus: "COMPLETED",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Final Step", status: "completed" },
          ],
          connections: [],
          project: {
            workflow_state: "completed",
          },
        },
        status: "completed",
      };

      mockStakworkService.getWorkflowData.mockResolvedValue(mockWorkflowData);

      const request = new NextRequest(
        "http://localhost:3000/api/stakwork/workflow/11111",
        { method: "GET" }
      );
      const params = Promise.resolve({ projectId: "11111" });

      const response = await GET(request, { params });

      const data = await expectSuccess(response, 200);

      // Hook uses this to stop polling: if (data.status === "completed")
      expect(data.status).toBe("completed");
    });
  });
});