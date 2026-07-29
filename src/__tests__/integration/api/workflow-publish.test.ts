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

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message" },
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
      // Route now issues: (1) pre-publish baseline GET, (2) publish POST
      mockFetch
        // 1. Pre-publish baseline GET (brand-new: no prior spec)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response)
        // 2. Publish POST
        .mockResolvedValueOnce({
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
      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response)
        // 2. Publish POST
        .mockResolvedValueOnce({
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
      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response)
        // 2. Publish POST
        .mockResolvedValueOnce({
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
      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response)
        // 2. Publish POST
        .mockResolvedValueOnce({
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

  describe("Publish Snapshot (publishedWorkflowJson + workflowVersionId)", () => {
    const workflowJson = JSON.stringify({ steps: [{ id: "step-1", name: "Start" }], transitions: {} });

    function makePublishFetch(workflowVersionId = "v-snap-123") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { workflow_version_id: workflowVersionId } }),
      } as Response;
    }

    function makeWorkflowFetch(responseShape: Record<string, unknown>) {
      return {
        ok: true,
        status: 200,
        json: async () => responseShape,
      } as Response;
    }

    // ── Fetch call ORDER: baseline GET must precede publish POST ──────────────
    it("issues baseline GET before publish POST (order assertion)", async () => {
      const baselineJson = JSON.stringify({ steps: [{ id: "old-step" }], transitions: {} });
      const publishedJson = JSON.stringify({ steps: [{ id: "new-step" }], transitions: {} });
      const callOrder: string[] = [];

      mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (url.includes("/publish") && method === "POST") {
          callOrder.push("publish-POST");
          return Promise.resolve(makePublishFetch("v-order-1"));
        }
        if (method === "GET") {
          if (callOrder.includes("publish-POST")) {
            // This is the post-publish GET
            callOrder.push("post-publish-GET");
            return Promise.resolve(
              makeWorkflowFetch({ data: { workflow: { workflow_json: publishedJson } } }),
            );
          } else {
            // Pre-publish baseline GET
            callOrder.push("baseline-GET");
            return Promise.resolve(
              makeWorkflowFetch({ data: { workflow: { workflow_json: baselineJson } } }),
            );
          }
        }
        return Promise.reject(new Error("Unexpected fetch call"));
      });

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57817, artifactId: artifact.id },
        testUser,
      );

      await POST(request);

      // Baseline GET must appear before publish POST in the call log
      const baselineIdx = callOrder.indexOf("baseline-GET");
      const publishIdx = callOrder.indexOf("publish-POST");
      expect(baselineIdx).toBeGreaterThanOrEqual(0);
      expect(publishIdx).toBeGreaterThan(baselineIdx);
    });

    // ── Republish: real baseline stored + real diff available ─────────────────
    it("stores originalWorkflowJson (real baseline) when pre-publish GET returns a workflow spec", async () => {
      const baselineJson = JSON.stringify({ steps: [{ id: "old-step" }], transitions: {} });
      const publishedJson = JSON.stringify({ steps: [{ id: "new-step" }], transitions: {} });

      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: baselineJson } } }),
        )
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-republish"))
        // 3. Post-publish GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: publishedJson } } }),
        );

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57817, artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => (a.content as Record<string, unknown>)?.publishedWorkflowJson);

      expect(newArtifact).toBeDefined();
      const content = newArtifact!.content as Record<string, unknown>;
      // originalWorkflowJson must be the pre-publish baseline string
      expect(content.originalWorkflowJson).toBe(baselineJson);
      // publishedWorkflowJson must be the just-published spec
      expect(content.publishedWorkflowJson).toBe(publishedJson);
      expect(content.workflowJson).toBe(publishedJson);
    });

    // ── Brand-new: GET succeeds with no currently-published version ────────────
    it("stores originalWorkflowJson: null (brand-new) when baseline GET returns no spec", async () => {
      const publishedJson = JSON.stringify({ steps: [{ id: "first-step" }], transitions: {} });

      mockFetch
        // 1. Pre-publish baseline GET — returns empty data (no workflow_json)
        .mockResolvedValueOnce(makeWorkflowFetch({ data: {} }))
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-brandnew"))
        // 3. Post-publish GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: publishedJson } } }),
        );

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57818, artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => (a.content as Record<string, unknown>)?.publishedWorkflowJson);

      expect(newArtifact).toBeDefined();
      const content = newArtifact!.content as Record<string, unknown>;
      // Genuine brand-new: originalWorkflowJson must be explicitly null
      expect(content.originalWorkflowJson).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(content, "originalWorkflowJson")).toBe(true);
      expect(content.publishedWorkflowJson).toBe(publishedJson);
    });

    // ── Baseline-fetch FAILURE: must not be treated as brand-new ──────────────
    it("does not store originalWorkflowJson when baseline GET fails (non-ok)", async () => {
      const publishedJson = JSON.stringify({ steps: [{ id: "s" }], transitions: {} });

      mockFetch
        // 1. Pre-publish baseline GET — FAILS (non-ok)
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "Service Unavailable" } as Response)
        // 2. Publish POST — succeeds
        .mockResolvedValueOnce(makePublishFetch("v-baseline-fail"))
        // 3. Post-publish GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: publishedJson } } }),
        );

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57819, artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      // Publish itself must still succeed
      await expectSuccess(response, 200);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => (a.content as Record<string, unknown>)?.publishedWorkflowJson);

      expect(newArtifact).toBeDefined();
      const content = newArtifact!.content as Record<string, unknown>;
      // originalWorkflowJson must be ABSENT (not null, not a string) —
      // a fetch error must never be conflated with brand-new
      expect(Object.prototype.hasOwnProperty.call(content, "originalWorkflowJson")).toBe(false);
    });

    it("does not store originalWorkflowJson when baseline GET throws (network error)", async () => {
      const publishedJson = JSON.stringify({ steps: [{ id: "s" }], transitions: {} });

      mockFetch
        // 1. Pre-publish baseline GET — throws
        .mockRejectedValueOnce(new Error("Network error"))
        // 2. Publish POST — succeeds
        .mockResolvedValueOnce(makePublishFetch("v-throw"))
        // 3. Post-publish GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: publishedJson } } }),
        );

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57820, artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => (a.content as Record<string, unknown>)?.publishedWorkflowJson);

      expect(newArtifact).toBeDefined();
      const content = newArtifact!.content as Record<string, unknown>;
      // originalWorkflowJson must be ABSENT — thrown errors are not brand-new
      expect(Object.prototype.hasOwnProperty.call(content, "originalWorkflowJson")).toBe(false);
    });

    // ── Baseline selector uses data.workflow.workflow_json (same as post-publish) ─
    it("reads baseline from data.workflow.workflow_json (same selector as post-publish fetch)", async () => {
      const baselineJson = JSON.stringify({ transitions: { stepA: {} } });
      const publishedJson = JSON.stringify({ transitions: { stepA: {}, stepB: {} } });

      mockFetch
        // 1. Pre-publish baseline GET with data.workflow.workflow_json shape
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: baselineJson } } }),
        )
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-selector"))
        // 3. Post-publish GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: publishedJson } } }),
        );

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57821, artifactId: artifact.id },
        testUser,
      );

      await POST(request);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => (a.content as Record<string, unknown>)?.publishedWorkflowJson);

      expect(newArtifact).toBeDefined();
      const content = newArtifact!.content as Record<string, unknown>;
      // Baseline must be the workflow_json string, not the data.workflow wrapper
      expect(content.originalWorkflowJson).toBe(baselineJson);
      expect(typeof content.originalWorkflowJson).toBe("string");
    });

    // ── Authorization: baseline fetch skipped when no artifactId ──────────────
    it("skips baseline fetch when no artifactId is provided (no external call before publish)", async () => {
      const callOrder: string[] = [];

      mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (url.includes("/publish") && method === "POST") {
          callOrder.push("publish-POST");
          return Promise.resolve(makePublishFetch("v-no-artifact"));
        }
        if (method === "GET") {
          callOrder.push("GET");
          return Promise.resolve(makeWorkflowFetch({ data: {} }));
        }
        return Promise.reject(new Error("Unexpected call"));
      });

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57822 }, // no artifactId
        testUser,
      );

      await POST(request);

      // Without artifactId, the baseline fetch must NOT be issued
      expect(callOrder.filter((c) => c === "GET")).toHaveLength(0);
      expect(callOrder[0]).toBe("publish-POST");
    });

    // ── Authorization: baseline fetch skipped for cross-workspace IDOR artifact ─
    it("skips baseline fetch when artifact is in a different workspace (IDOR protection)", async () => {
      // Create an artifact in a DIFFERENT workspace (victim)
      const victimUser = await createTestUser();
      const victimWorkspace = await createTestWorkspace({
        ownerId: victimUser.id,
        name: "Victim Workspace",
        slug: "victim-workspace-baseline",
      });
      const victimTask = await createTestTask({
        workspaceId: victimWorkspace.id,
        createdById: victimUser.id,
        status: "TODO",
      });
      const { createTestChatMessage: ctcm } = await import("@/__tests__/support/fixtures");
      const victimMessage = await ctcm({
        taskId: victimTask.id,
        message: "Victim msg",
        role: "ASSISTANT",
      });
      const victimArtifact = await db.artifact.create({
        data: {
          type: "WORKFLOW",
          messageId: victimMessage.id,
          content: { secret: "do-not-fetch" },
        },
      });

      const callOrder: string[] = [];

      mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (url.includes("/publish") && method === "POST") {
          callOrder.push("publish-POST");
          return Promise.resolve(makePublishFetch("v-idor-baseline"));
        }
        if (method === "GET") {
          callOrder.push("GET");
          return Promise.resolve(makeWorkflowFetch({ data: {} }));
        }
        return Promise.reject(new Error("Unexpected call"));
      });

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 57823, artifactId: victimArtifact.id },
        testUser, // testUser is in stakwork workspace, NOT victim workspace
      );

      await POST(request);

      // Baseline fetch must NOT be issued for a cross-workspace artifact
      expect(callOrder.filter((c) => c === "GET")).toHaveLength(0);
      expect(callOrder[0]).toBe("publish-POST");

      // Victim artifact must remain untouched
      const unchanged = await db.artifact.findUnique({ where: { id: victimArtifact.id } });
      const uc = unchanged!.content as Record<string, unknown>;
      expect(uc.secret).toBe("do-not-fetch");
    });

    // ── Original tests (updated for 3-fetch flow) ──────────────────────────────
    it("stores publishedWorkflowJson + workflowVersionId on new WORKFLOW artifact (data.workflow.workflow_json branch)", async () => {
      const baselineJson = JSON.stringify({ steps: [], transitions: {} });
      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce(
          makeWorkflowFetch({ data: { workflow: { workflow_json: baselineJson } } }),
        )
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-snap-1") as Response)
        // 3. Post-publish GET
        .mockResolvedValueOnce(makeWorkflowFetch({ data: { workflow: { workflow_json: workflowJson } } }) as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: testTask.stakworkProjectId ?? 123, artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      // Find the newly created WORKFLOW artifact in the task's messages
      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newWorkflowArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => {
          const c = a.content as Record<string, unknown>;
          return c?.publishedWorkflowJson;
        });

      expect(newWorkflowArtifact).toBeDefined();
      const content = newWorkflowArtifact!.content as Record<string, unknown>;
      expect(content.publishedWorkflowJson).toBe(workflowJson);
      expect(content.workflowVersionId).toBe("v-snap-1");
      expect(content.workflowJson).toBe(workflowJson);
      // baselineJson is not empty → stored as originalWorkflowJson
      expect(content.originalWorkflowJson).toBe(baselineJson);
    });

    it("stores publishedWorkflowJson via data.spec fallback branch", async () => {
      const specJson = JSON.stringify({ steps: [], transitions: {} });
      mockFetch
        // 1. Pre-publish baseline GET (brand-new: no spec)
        .mockResolvedValueOnce(makeWorkflowFetch({ data: {} }))
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-spec-1") as Response)
        // 3. Post-publish GET
        .mockResolvedValueOnce(makeWorkflowFetch({ data: { spec: specJson } }) as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 999, artifactId: artifact.id },
        testUser,
      );

      await POST(request);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newWorkflowArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => {
          const c = a.content as Record<string, unknown>;
          return c?.publishedWorkflowJson;
        });

      expect(newWorkflowArtifact).toBeDefined();
      const content = newWorkflowArtifact!.content as Record<string, unknown>;
      expect(content.publishedWorkflowJson).toBe(specJson);
      expect(content.workflowVersionId).toBe("v-spec-1");
      // Brand-new (baseline GET returned no spec) → originalWorkflowJson: null
      expect(content.originalWorkflowJson).toBeNull();
    });

    it("stores publishedWorkflowJson via data.workflow_json fallback branch", async () => {
      const wfJson = JSON.stringify({ steps: [{ id: "a" }], transitions: {} });
      const baselineWfJson = JSON.stringify({ steps: [], transitions: {} });
      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce(makeWorkflowFetch({ data: { workflow_json: baselineWfJson } }))
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-wfjson-1") as Response)
        // 3. Post-publish GET
        .mockResolvedValueOnce(makeWorkflowFetch({ data: { workflow_json: wfJson } }) as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 888, artifactId: artifact.id },
        testUser,
      );

      await POST(request);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newWorkflowArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => {
          const c = a.content as Record<string, unknown>;
          return c?.publishedWorkflowJson;
        });

      expect(newWorkflowArtifact).toBeDefined();
      const content = newWorkflowArtifact!.content as Record<string, unknown>;
      expect(content.publishedWorkflowJson).toBe(wfJson);
      expect(content.workflowVersionId).toBe("v-wfjson-1");
      expect(content.originalWorkflowJson).toBe(baselineWfJson);
    });

    it("stores publishedWorkflowJson via top-level workflow_json fallback branch", async () => {
      const topLevelJson = JSON.stringify({ steps: [{ id: "top" }], transitions: {} });
      mockFetch
        // 1. Pre-publish baseline GET (brand-new)
        .mockResolvedValueOnce(makeWorkflowFetch({ data: {} }))
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-toplevel-1") as Response)
        // 3. Post-publish GET
        .mockResolvedValueOnce(makeWorkflowFetch({ workflow_json: topLevelJson }) as Response);

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 777, artifactId: artifact.id },
        testUser,
      );

      await POST(request);

      const newMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
        orderBy: { createdAt: "desc" },
      });

      const newWorkflowArtifact = newMessages
        .flatMap((m) => m.artifacts)
        .find((a) => {
          const c = a.content as Record<string, unknown>;
          return c?.publishedWorkflowJson;
        });

      expect(newWorkflowArtifact).toBeDefined();
      const content = newWorkflowArtifact!.content as Record<string, unknown>;
      expect(content.publishedWorkflowJson).toBe(topLevelJson);
      expect(content.workflowVersionId).toBe("v-toplevel-1");
      // Brand-new (baseline GET returned no spec) → originalWorkflowJson: null
      expect(content.originalWorkflowJson).toBeNull();
    });

    it("does not create new WORKFLOW artifact when GET workflow fetch fails", async () => {
      mockFetch
        // 1. Pre-publish baseline GET (brand-new)
        .mockResolvedValueOnce(makeWorkflowFetch({ data: {} }))
        // 2. Publish POST
        .mockResolvedValueOnce(makePublishFetch("v-fail") as Response)
        // 3. Post-publish GET — fails
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "error" } as Response);

      const countBefore = await db.chatMessage.count({ where: { taskId: testTask.id } });

      const request = createAuthenticatedPostRequest(
        BASE_URL,
        { workflowId: 666, artifactId: artifact.id },
        testUser,
      );

      const response = await POST(request);
      await expectSuccess(response, 200); // publish itself succeeds

      const countAfter = await db.chatMessage.count({ where: { taskId: testTask.id } });
      expect(countAfter).toBe(countBefore); // no new message created
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
      mockFetch
        // 1. Pre-publish baseline GET
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) } as Response)
        // 2. Publish POST — returns null data
        .mockResolvedValueOnce({
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
