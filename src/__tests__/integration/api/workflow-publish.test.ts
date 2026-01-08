import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/workflow/publish/route";
import { db } from "@/lib/db";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
} from "@/__tests__/support/helpers/api-assertions";
import {
  expectWorkspaceExists,
  expectMemberRole,
} from "@/__tests__/support/helpers/database-assertions";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  createTestChatMessage,
} from "@/__tests__/support/fixtures";
import { getMockedSession, createAuthenticatedSession } from "@/__tests__/support/helpers/auth";

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-key-123",
  },
  USE_MOCKS: false,
  PUSHER_CONFIG: {
    appId: "test-app-id",
    key: "test-key",
    secret: "test-secret",
    cluster: "test-cluster",
    publicKey: "test-public-key",
    publicCluster: "test-cluster",
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
  isSwarmFakeModeEnabled: vi.fn(() => false),
}));

import { isDevelopmentMode } from "@/lib/runtime";

const mockGetServerSession = getMockedSession();
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

describe("POST /api/workflow/publish", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: { id: string; email: string; name: string };
  let testTask: any;
  let testMessage: any;
  let artifact: { id: string };
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    testUser = await createTestUser();
    otherUser = await createTestUser();

    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      name: "Stakwork",
      slug: "stakwork",
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: stakworkWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });

    // Create task and message for artifact relation
    testTask = await createTestTask({
      workspaceId: stakworkWorkspace.id,
      createdById: testUser.id,
      status: "TODO",
    });

    testMessage = await createTestChatMessage({
      taskId: testTask.id,
      message: "Test message for artifact",
      role: "ASSISTANT",
    });

    artifact = await db.artifact.create({
      data: {
        type: "WORKFLOW",
        messageId: testMessage.id,
        content: {
          workflowId: "wf-123",
          existingField: "value",
        },
      },
    });

    // Reset mocks to default state
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();
    mockFetch.mockReset();
    
    // Set default for isDevelopmentMode
    mockIsDevelopmentMode.mockReturnValue(false);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    it("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    it("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      await expectError(response, "Invalid user session", 401);
    });

    it("allows authenticated user with valid session", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Authorization", () => {
    it("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    it("allows workspace owner to publish", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      await expectMemberRole(stakworkWorkspace.id, testUser.id, "OWNER");

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    it("allows workspace member (DEVELOPER role) to publish", async () => {
      const memberUser = await db.user.create({
        data: {
          email: "developer@example.com",
          name: "Developer User",
        },
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: stakworkWorkspace.id,
          userId: memberUser.id,
          role: "DEVELOPER",
        },
      });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: memberUser.id, email: memberUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-456" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-456" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-456");
    });
  });

  describe("Development Mode", () => {
    it("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-dev" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-dev" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation", () => {
    it("returns 400 when workflowId is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      await expectError(response, "workflowId is required", 400);
    });

    it("returns 400 when workflowId is empty string", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "" }),
      });

      const response = await POST(request);
      await expectError(response, "workflowId is required", 400);
    });

    it("accepts valid workflowId", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-valid" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-valid-123" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.workflowId).toBe("wf-valid-123");
    });
  });

  describe("Stakwork API Integration", () => {
    it("calls Stakwork API with correct URL and headers", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/workflows/wf-123/publish",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Token token=test-key-123",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("handles successful Stakwork API response", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-success" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-success" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-success");
      expect(data.data.published).toBe(true);
      expect(data.data.message).toBe("Workflow published successfully");
    });

    it("handles Stakwork API error response with non-ok status", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-error" }),
      });

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });

    it("handles Stakwork API response with success: false", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          error: { message: "Workflow validation failed" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-invalid" }),
      });

      const response = await POST(request);
      await expectError(response, "Workflow validation failed", 400);
    });

    it("handles network errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-network-error" }),
      });

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });

    it("handles Stakwork API timeout", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-timeout" }),
      });

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });
  });

  describe("Artifact Updates", () => {
    it("updates artifact with published status when artifactId provided", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-123",
          artifactId: artifact.id,
        }),
      });

      const response = await POST(request);
      await expectSuccess(response, 200);

      const updatedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
      });

      expect(updatedArtifact).toBeTruthy();
      const content = updatedArtifact!.content as Record<string, any>;
      expect(content.published).toBe(true);
      expect(content.publishedAt).toBeTruthy();
      expect(content.workflowVersionId).toBe("v-123");
    });

    it("merges with existing artifact content", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-123",
          artifactId: artifact.id,
        }),
      });

      const response = await POST(request);
      await expectSuccess(response, 200);

      const updatedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
      });

      const content = updatedArtifact!.content as Record<string, any>;
      expect(content.existingField).toBe("value");
      expect(content.workflowId).toBe("wf-123");
      expect(content.published).toBe(true);
    });

    it("skips artifact update when artifactId not provided", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-no-artifact" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-123");

      const unchangedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
      });

      const content = unchangedArtifact!.content as Record<string, any>;
      expect(content.published).toBeUndefined();
    });

    it("handles artifact not found gracefully without failing request", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const nonExistentArtifactId = "00000000-0000-0000-0000-000000000000";

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-missing-artifact",
          artifactId: nonExistentArtifactId,
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-123");
    });

    it("includes publishedAt timestamp in ISO format", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-123" },
        }),
      } as Response);

      const beforePublish = new Date();

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-timestamp",
          artifactId: artifact.id,
        }),
      });

      await POST(request);

      const updatedArtifact = await db.artifact.findUnique({
        where: { id: artifact.id },
      });

      const content = updatedArtifact!.content as Record<string, any>;
      const publishedAt = new Date(content.publishedAt);

      expect(publishedAt).toBeInstanceOf(Date);
      expect(publishedAt.getTime()).toBeGreaterThanOrEqual(beforePublish.getTime());
    });
  });

  describe("Response Structure", () => {
    it("returns complete success response structure", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-response" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-complete",
          workflowRefId: "ref-123",
          artifactId: artifact.id,
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data).toMatchObject({
        success: true,
        data: {
          workflowId: "wf-complete",
          workflowRefId: "ref-123",
          published: true,
          workflowVersionId: "v-response",
          message: "Workflow published successfully",
        },
      });
    });

    it("includes workflowRefId in response when provided", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-response" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-ref",
          workflowRefId: "custom-ref-id",
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.workflowRefId).toBe("custom-ref-id");
    });
  });

  describe("Database Verification", () => {
    it("verifies workspace membership before publishing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-db-test" },
        }),
      } as Response);

      await expectWorkspaceExists(stakworkWorkspace.id);
      await expectMemberRole(stakworkWorkspace.id, testUser.id, "OWNER");

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: "wf-member-check" }),
      });

      const response = await POST(request);
      await expectSuccess(response, 200);
    });

    it("does not modify other artifacts", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-db-test" },
        }),
      } as Response);

      const otherMessage = await createTestChatMessage({
        taskId: testTask.id,
        message: "Other message for artifact",
        role: "ASSISTANT",
      });

      const otherArtifact = await db.artifact.create({
        data: {
          type: "WORKFLOW",
          messageId: otherMessage.id,
          content: { otherWorkflowId: "wf-other" },
        },
      });

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-isolated",
          artifactId: artifact.id,
        }),
      });

      await POST(request);

      const unchangedArtifact = await db.artifact.findUnique({
        where: { id: otherArtifact.id },
      });

      const content = unchangedArtifact!.content as Record<string, any>;
      expect(content.published).toBeUndefined();
      expect(content.otherWorkflowId).toBe("wf-other");
    });
  });

  describe("Edge Cases", () => {
    it("handles malformed JSON body", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: "invalid json{",
      });

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });

    it("handles Stakwork API returning null data", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: null,
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({
          workflowId: "wf-null-data",
          artifactId: artifact.id,
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBeUndefined();
    });

    it("handles very long workflowId", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { workflow_version_id: "v-long" },
        }),
      } as Response);

      const longWorkflowId = "wf-" + "x".repeat(500);

      const request = new NextRequest("http://localhost:3000/api/workflow/publish", {
        method: "POST",
        body: JSON.stringify({ workflowId: longWorkflowId }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.workflowId).toBe(longWorkflowId);
    });
  });
});
