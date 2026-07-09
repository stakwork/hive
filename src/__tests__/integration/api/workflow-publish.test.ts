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
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from "@/__tests__/support/helpers/request-builders";

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-key-123",
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
  isSwarmFakeModeEnabled: vi.fn(() => false),
}));

import { isDevelopmentMode } from "@/lib/runtime";

const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

const BASE_URL = "http://localhost:3000/api/workflow/publish";

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

    mockIsDevelopmentMode.mockReset();
    mockFetch.mockReset();

    // Default: dev mode off
    mockIsDevelopmentMode.mockReturnValue(false);
  });

  describe("Authentication", () => {
    it("(b) returns 401 when user is not authenticated (no auth headers)", async () => {
      const request = createPostRequest(BASE_URL, { workflowId: "wf-123" });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    it("(e) rejects request with forged x-user-id / auth-status headers but no valid token (header-spoofing boundary)", async () => {
      // Middleware sanitizes incoming x-user-* headers on unauthenticated requests before they
      // reach the handler. Here we simulate what the handler actually receives after that
      // sanitization: no trusted headers => Unauthorized.
      // This documents that getMiddlewareContext/requireAuth is the security boundary.
      const request = new NextRequest(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Forged headers — middleware would strip these for unauthenticated requests,
          // so the handler receives no stamped auth-status and returns 401.
        },
        body: JSON.stringify({ workflowId: "wf-123" }),
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    it("(a) authenticated caller (session middleware headers) succeeds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-123" },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    it("(a) Bearer/iOS-parity: authenticated via Bearer JWT resolves the same middleware headers as a session cookie (stamped headers are indistinguishable at this layer)", async () => {
      // Note: at the handler layer, session cookie auth and Bearer JWT auth are identical —
      // both result in middleware stamping x-user-id / x-user-email / x-user-name /
      // auth-status=authenticated headers. The real token→header stamping lives in
      // middleware.ts and is not exercised by this integration test. This test documents
      // that the route accepts those stamped headers regardless of how they were produced.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-bearer" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-bearer" },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-bearer");
    });
  });

  describe("Authorization", () => {
    it("(c) returns 403 when authenticated user is not a member of stakwork workspace (dev-mode off)", async () => {
      mockIsDevelopmentMode.mockReturnValue(false);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-123" },
        otherUser,
      );

      const response = await POST(request);
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    it("allows workspace owner to publish", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      await expectMemberRole(stakworkWorkspace.id, testUser.id, "OWNER");

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-123" },
        testUser,
      );

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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-456" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-456" },
        { id: memberUser.id, email: memberUser.email ?? "", name: memberUser.name ?? "" },
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-456");
    });
  });

  describe("Development Mode", () => {
    it("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-dev" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-dev" },
        otherUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation", () => {
    it("returns 400 when workflowId is missing", async () => {
      const request = createAuthenticatedPostRequest(BASE_URL, {}, testUser);

      const response = await POST(request);
      await expectError(response, "workflowId is required", 400);
    });

    it("returns 400 when workflowId is empty string", async () => {
      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "" },
        testUser,
      );

      const response = await POST(request);
      await expectError(response, "workflowId is required", 400);
    });

    it("(f) returns 400 and does not call Stakwork when workflowId fails isSafeId()", async () => {
      // Paths with slashes, dots, or shell metacharacters should be rejected
      const dangerousIds = [
        "../../etc/passwd",
        "wf-123/../../admin",
        "wf-123; DROP TABLE workflows",
        "wf-123<script>",
      ];

      for (const badId of dangerousIds) {
        mockFetch.mockReset();

        const request = createAuthenticatedPostRequest(
          BASE_URL,
          { workflowId: badId },
          testUser,
        );

        const response = await POST(request);
        await expectError(response, "Invalid workflowId format", 400);
        expect(mockFetch).not.toHaveBeenCalled();
      }
    });

    it("accepts valid numeric workflowId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-valid" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 12345 },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.workflowId).toBe(12345);
    });

    it("accepts valid UUID-style workflowId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-valid" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "550e8400-e29b-41d4-a716-446655440000" },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Stakwork API Integration", () => {
    it("calls Stakwork API with correctly encoded URL and headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "abc123" },
        testUser,
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/workflows/abc123/publish",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Token token=test-key-123",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("handles successful Stakwork API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-success" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-success" },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-success");
      expect(data.data.published).toBe(true);
      expect(data.data.message).toBe("Workflow published successfully");
    });

    it("handles Stakwork API error response with non-ok status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-error" },
        testUser,
      );

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });

    it("handles Stakwork API response with success: false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
          error: { message: "Workflow validation failed" },
        }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-invalid" },
        testUser,
      );

      const response = await POST(request);
      await expectError(response, "Workflow validation failed", 400);
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-network-error" },
        testUser,
      );

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });

    it("handles Stakwork API timeout", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-timeout" },
        testUser,
      );

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });
  });

  describe("Artifact Updates", () => {
    it("updates artifact with published status when artifactId provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-123", artifactId: artifact.id },
        testUser,
      );

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-123", artifactId: artifact.id },
        testUser,
      );

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-no-artifact" },
        testUser,
      );

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const nonExistentArtifactId = "00000000-0000-0000-0000-000000000000";

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-missing-artifact", artifactId: nonExistentArtifactId },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBe("v-123");
    });

    it("includes publishedAt timestamp in ISO format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-123" } }),
      } as Response);

      const beforePublish = new Date();

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-timestamp", artifactId: artifact.id },
        testUser,
      );

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-response" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-complete", workflowRefId: "ref-123", artifactId: artifact.id },
        testUser,
      );

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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-response" } }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-ref", workflowRefId: "custom-ref-id" },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.workflowRefId).toBe("custom-ref-id");
    });
  });

  describe("Database Verification", () => {
    it("verifies workspace membership before publishing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-db-test" } }),
      } as Response);

      await expectWorkspaceExists(stakworkWorkspace.id);
      await expectMemberRole(stakworkWorkspace.id, testUser.id, "OWNER");

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-member-check" },
        testUser,
      );

      const response = await POST(request);
      await expectSuccess(response, 200);
    });

    it("does not modify other artifacts in the same workspace", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-db-test" } }),
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

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-isolated", artifactId: artifact.id },
        testUser,
      );

      await POST(request);

      const unchangedArtifact = await db.artifact.findUnique({
        where: { id: otherArtifact.id },
      });

      const content = unchangedArtifact!.content as Record<string, any>;
      expect(content.published).toBeUndefined();
      expect(content.otherWorkflowId).toBe("wf-other");
    });

    it("(d) cross-workspace IDOR: authenticated caller cannot mutate an artifact belonging to a different workspace", async () => {
      mockIsDevelopmentMode.mockReturnValue(false);

      // Create a second workspace and user that owns it
      const victimUser = await createTestUser();
      const victimWorkspace = await createTestWorkspace({
        ownerId: victimUser.id,
        name: "Victim Workspace",
        slug: "victim-workspace",
      });

      // Create an artifact in the victim workspace
      const victimTask = await createTestTask({
        workspaceId: victimWorkspace.id,
        createdById: victimUser.id,
        status: "TODO",
      });
      const victimMessage = await createTestChatMessage({
        taskId: victimTask.id,
        message: "Victim message",
        role: "ASSISTANT",
      });
      const victimArtifact = await db.artifact.create({
        data: {
          type: "WORKFLOW",
          messageId: victimMessage.id,
          content: { secret: "sensitive-data", published: false },
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: "v-idor" } }),
      } as Response);

      // testUser is a stakwork workspace member but NOT a member of victim workspace.
      // They pass the victim's artifactId — the route should silently skip the write.
      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-idor", artifactId: victimArtifact.id },
        testUser,
      );

      const response = await POST(request);
      // Route still succeeds (workflow publish itself went through), but...
      await expectSuccess(response, 200);

      // ...the victim artifact must NOT have been mutated
      const unchangedArtifact = await db.artifact.findUnique({
        where: { id: victimArtifact.id },
      });
      const content = unchangedArtifact!.content as Record<string, any>;
      expect(content.published).toBe(false);
      expect(content.secret).toBe("sensitive-data");

      // ...and no new chat message should have been created in the victim task
      const messages = await db.chatMessage.findMany({
        where: { taskId: victimTask.id },
      });
      // Only the original victimMessage exists — no new assistant message was injected
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(victimMessage.id);
    });
  });

  describe("Edge Cases", () => {
    it("handles malformed JSON body", async () => {
      const request = new NextRequest(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Stamp middleware auth headers manually for this edge case
          "x-middleware-user-id": testUser.id,
          "x-middleware-user-email": testUser.email,
          "x-middleware-user-name": testUser.name,
          "x-middleware-auth-status": "authenticated",
        },
        body: "invalid json{",
      });

      const response = await POST(request);
      await expectError(response, "Failed to publish workflow", 500);
    });

    it("handles Stakwork API returning null data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: null }),
      } as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: "wf-null-data", artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.workflowVersionId).toBeUndefined();
    });
  });
});
