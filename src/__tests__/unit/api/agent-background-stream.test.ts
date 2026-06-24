import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const afterCallbacks = vi.hoisted(() => [] as Array<() => void | Promise<void>>);

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((callback: () => void | Promise<void>) => {
      afterCallbacks.push(callback);
    }),
  };
});

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn().mockReturnValue({
      encryptField: vi.fn().mockReturnValue({ data: "enc", iv: "iv", tag: "tag" }),
      decryptField: vi.fn().mockReturnValue("decrypted-secret"),
    }),
  },
}));

vi.mock("@/lib/pods", () => ({
  claimPodAndGetFrontend: vi.fn(),
  updatePodRepositories: vi.fn(),
  POD_PORTS: { CONTROL: "15552" },
  releasePodById: vi.fn(),
}));

vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn().mockResolvedValue("webhook-token"),
  generateWebhookSecret: vi.fn().mockReturnValue("webhook-secret"),
}));

vi.mock("@/lib/ai/models", () => ({
  isValidModel: vi.fn().mockReturnValue(false),
  getApiKeyForModel: vi.fn().mockReturnValue("model-api-key"),
}));

vi.mock("@/lib/feature-flags", () => ({
  canAccessServerFeature: vi.fn().mockReturnValue(true),
  FEATURE_FLAGS: { TASK_AGENT_MODE: "TASK_AGENT_MODE" },
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn().mockResolvedValue(null),
}));

const mockFetch = vi.fn();
const originalFetch = global.fetch;

function buildRequest(body: object) {
  return new NextRequest("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent background stream", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    global.fetch = mockFetch;
    process.env.NEXTAUTH_URL = "http://hive.test";

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getServerSession } = await import("next-auth/next");
    const { db } = await import("@/lib/db");

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@example.com" },
    } as any);

    vi.mocked(db.task.findUnique).mockResolvedValue({
      id: "task-1",
      workspaceId: "workspace-1",
      podId: "pod-1",
      agentUrl: "https://agent.example.com/",
      agentPassword: JSON.stringify({ data: "enc" }),
      agentWebhookSecret: JSON.stringify({ data: "enc" }),
      mode: "agent",
      model: null,
      workspace: {
        ownerId: "user-1",
        slug: "hive",
        members: [],
      },
    } as any);
    vi.mocked(db.chatMessage.count).mockResolvedValue(0);
    vi.mocked(db.chatMessage.create).mockResolvedValue({ id: "message-1" } as any);

    mockFetch.mockImplementation((url: string) => {
      if (url === "https://agent.example.com/session") {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "stream-token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url === "https://agent.example.com/stream/task-1?token=stream-token") {
        return Promise.resolve(new Response("data: done\n\n", { status: 200 }));
      }

      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NEXTAUTH_URL;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("saves a STREAM artifact and starts the remote stream from after()", async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/agent/route");

    const response = await POST(
      buildRequest({
        taskId: "task-1",
        message: "hello",
        startStreamInBackground: true,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      sessionId: "task-1",
      streamToken: "stream-token",
      streamUrl: "https://agent.example.com/stream/task-1",
      backgroundStream: true,
      eventsToken: "stream-token",
      eventsBaseUrl: "https://agent.example.com",
    });

    expect(afterCallbacks).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalledWith(
      "https://agent.example.com/stream/task-1?token=stream-token",
      expect.anything(),
    );

    const savedMessage = vi.mocked(db.chatMessage.create).mock.calls[0][0];
    const savedArtifacts = savedMessage.data.artifacts?.create ?? [];
    expect(savedArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "STREAM",
          content: expect.objectContaining({
            requestId: "task-1",
            eventsToken: "stream-token",
            baseUrl: "https://agent.example.com",
            agent: "coder-agent",
          }),
        }),
      ]),
    );

    await afterCallbacks[0]();

    const streamCall = mockFetch.mock.calls.find(([url]) =>
      String(url).includes("/stream/task-1"),
    );
    expect(streamCall).toBeDefined();
    expect(streamCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      "[Agent] Background stream failed:",
      expect.anything(),
    );
  });
});
