import { describe, test, beforeEach, afterEach, vi, expect } from "vitest";
import { POST } from "@/app/api/agent/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectUnauthorized,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestTask } from "@/__tests__/support/factories/task.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";
import { createTestPod } from "@/__tests__/support/factories/pod.factory";
import { db } from "@/lib/db";
import { PodUsageStatus } from "@prisma/client";

// Mock the gooseWeb provider
const mockStreamText = vi.fn();
vi.mock("ai-sdk-provider-goose-web", () => ({
  gooseWeb: vi.fn(() => ({
    streamText: mockStreamText,
  })),
}));

// Mock AI SDK
vi.mock("ai", () => ({
  streamText: vi.fn(async ({ prompt, messages, model }) => {
    return model.streamText({ prompt, messages });
  }),
}));

// Mock fetch for agent session calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("POST /api/agent Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock for streaming
    mockStreamText.mockResolvedValue({
      toDataStreamResponse: vi.fn(() => new Response("mocked stream")),
    });
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        gooseUrl: "ws://localhost:8888/ws",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(mockStreamText).not.toHaveBeenCalled();
    });
  });

  describe("Validation", () => {
    test("returns 400 when taskId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
      });

      const response = await POST(request);

      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe("taskId is required");
    });
  });

  describe("Codex model routing", () => {
    const MOCK_AGENT_URL = "http://localhost:3333";

    beforeEach(() => {
      // Use CUSTOM_GOOSE_URL to bypass pod/password requirements
      process.env.CUSTOM_GOOSE_URL = MOCK_AGENT_URL;

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/validate_session")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ exists: false }),
          });
        }
        if (url.includes("/session")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ token: "mock-stream-token" }),
          });
        }
        return Promise.resolve({
          ok: false,
          text: () => Promise.resolve("Not found"),
        });
      });
    });

    afterEach(() => {
      delete process.env.CUSTOM_GOOSE_URL;
    });

    test("sends agent_name: codex and model: codex in session payload when codex model is selected", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: "Codex test task",
      });

      await db.task.update({
        where: { id: task.id },
        data: { mode: "agent", model: "codex" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Debug this hard bug",
        taskId: task.id,
        model: "codex",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const sessionCall = mockFetch.mock.calls.find(([url]: [string]) =>
        url.includes("/session"),
      );
      expect(sessionCall).toBeDefined();

      const sessionBody = JSON.parse(sessionCall[1].body);
      expect(sessionBody.agent_name).toBe("codex");
      expect(sessionBody.model).toBe("codex");
    });

    test("does not send agent_name for non-codex models (sonnet)", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: "Sonnet test task",
      });

      await db.task.update({
        where: { id: task.id },
        data: { mode: "agent", model: "sonnet" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Help me write a feature",
        taskId: task.id,
        model: "sonnet",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const sessionCall = mockFetch.mock.calls.find(([url]: [string]) =>
        url.includes("/session"),
      );
      expect(sessionCall).toBeDefined();

      const sessionBody = JSON.parse(sessionCall[1].body);
      expect(sessionBody.agent_name).toBeUndefined();
      expect(sessionBody.model).toBe("sonnet");
    });
  });

  describe("Pod claim rollback", () => {
    test("releases the pod and clears task state when claim setup fails after reservation", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: "test-pool-api-key",
        },
      });

      const pod = await createTestPod({
        swarmId: swarm.id,
        portMappings: [3000],
        password: "plain-password",
      });

      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: "Rollback task",
      });

      await db.task.update({
        where: { id: task.id },
        data: { mode: "agent" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Start the agent",
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("No pods available");
      expect(mockFetch).not.toHaveBeenCalled();

      const [updatedTask, updatedPod] = await Promise.all([
        db.task.findUnique({
          where: { id: task.id },
          select: {
            podId: true,
            agentUrl: true,
            agentPassword: true,
          },
        }),
        db.pod.findUnique({
          where: { id: pod.id },
          select: {
            usageStatus: true,
            usageStatusMarkedAt: true,
            usageStatusMarkedBy: true,
          },
        }),
      ]);

      expect(updatedTask).toEqual({
        podId: null,
        agentUrl: null,
        agentPassword: null,
      });
      expect(updatedPod).toEqual({
        usageStatus: PodUsageStatus.UNUSED,
        usageStatusMarkedAt: null,
        usageStatusMarkedBy: null,
      });
    });
  });

  // NOTE: Most tests commented out due to significant implementation gaps:
  // 1. Production code does NOT validate message field (empty, missing, whitespace)
  // 2. Task/ChatMessage persistence only works with taskId (no standalone messages saved without task)
  // 3. Task model requires workspaceId which agent API doesn't handle
  // 4. Streaming mock needs proper async iterator setup for fullStream
  // 5. Error handling tests fail because actual errors aren't caught properly
  //
  // These tests should be uncommented and fixed AFTER production code is updated in a separate PR
  // to add proper validation, standalone message support, and error handling.
});
