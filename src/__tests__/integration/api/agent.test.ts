import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST, PUT } from "@/app/api/agent/route";
import { NextRequest } from "next/server";
import * as nextAuth from "next-auth/next";
import * as middlewareUtils from "@/lib/middleware/utils";
import * as nextAuthLib from "@/lib/auth/nextauth";
import * as askToolsLib from "@/lib/ai/askTools";
import * as repositoryHelpers from "@/lib/helpers/repository";
import { EncryptionService } from "@/lib/encryption";
import { streamText } from "ai";
import { gooseWeb } from "ai-sdk-provider-goose-web";
import * as aieo from "aieo";
import { ChatRole, ChatStatus } from "@/lib/chat";

// Mock external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/middleware/utils");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/ai/askTools");
vi.mock("@/lib/helpers/repository");
vi.mock("@/lib/encryption");
vi.mock("ai");
vi.mock("ai-sdk-provider-goose-web");
vi.mock("aieo");

describe("Integration: POST /api/agent", () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;

  beforeEach(async () => {
    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test-agent@example.com",
        name: "Test Agent User",
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-agent-workspace",
        ownerId: testUser.id,
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: "Test Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    // Mock NextAuth session
    vi.mocked(nextAuth.getServerSession).mockResolvedValue({
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
      },
    } as any);

    // Mock Goose Web provider
    vi.mocked(gooseWeb).mockReturnValue({} as any);

    // Mock streamText
    const mockStreamResponse = {
      fullStream: {
        [Symbol.asyncIterator]: async function* () {
          yield { type: "text-delta", id: "msg-1", text: "Hello" };
          yield { type: "finish", finishReason: "stop" };
        },
      },
    };
    vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);
  });

  afterEach(async () => {
    // Cleanup test data
    await db.chatMessage.deleteMany({
      where: { taskId: testTask.id },
    });
    await db.task.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspace.deleteMany({
      where: { id: testWorkspace.id },
    });
    await db.user.deleteMany({
      where: { id: testUser.id },
    });

    vi.clearAllMocks();
  });

  it("should persist message and create chat history", async () => {
    const message = "Help me debug this code";
    const artifacts = [
      {
        type: "code",
        content: { language: "typescript", code: "const x = 1;" },
      },
    ];

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      body: JSON.stringify({
        message,
        taskId: testTask.id,
        artifacts,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    // Verify message was persisted
    const savedMessages = await db.chatMessage.findMany({
      where: { taskId: testTask.id },
      include: { artifacts: true },
    });

    expect(savedMessages).toHaveLength(1);
    expect(savedMessages[0].message).toBe(message);
    expect(savedMessages[0].role).toBe(ChatRole.USER);
    expect(savedMessages[0].status).toBe(ChatStatus.SENT);
    expect(savedMessages[0].sourceWebsocketID).toMatch(/^\d{8}_\d{6}$/);
    expect(savedMessages[0].artifacts).toHaveLength(1);
    expect(savedMessages[0].artifacts[0].type).toBe("code");
  });

  it("should reuse session ID for subsequent messages", async () => {
    // Create first message
    const firstSessionId = "20240101_120000";
    await db.chatMessage.create({
      data: {
        taskId: testTask.id,
        message: "First message",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        sourceWebsocketID: firstSessionId,
      },
    });

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      body: JSON.stringify({
        message: "Second message",
        taskId: testTask.id,
      }),
    });

    await POST(request);

    // Verify Goose Web was called with existing session ID
    expect(gooseWeb).toHaveBeenCalledWith(
      "goose",
      expect.objectContaining({
        sessionId: firstSessionId,
      })
    );
  });

  it("should handle complete conversation flow", async () => {
    // Create conversation history
    const sessionId = "20240101_120000";
    await db.chatMessage.createMany({
      data: [
        {
          taskId: testTask.id,
          message: "What is TypeScript?",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          sourceWebsocketID: sessionId,
        },
        {
          taskId: testTask.id,
          message: "TypeScript is a typed superset of JavaScript",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          sourceWebsocketID: sessionId,
        },
      ],
    });

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      body: JSON.stringify({
        message: "Can you give me an example?",
        taskId: testTask.id,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    // Verify new message was added
    const allMessages = await db.chatMessage.findMany({
      where: { taskId: testTask.id },
      orderBy: { timestamp: "asc" },
    });

    expect(allMessages).toHaveLength(3);
    expect(allMessages[2].message).toBe("Can you give me an example?");

    // Verify history was passed to streamText
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          { role: "user", content: "What is TypeScript?" },
          { role: "assistant", content: "TypeScript is a typed superset of JavaScript" },
          { role: "user", content: "Can you give me an example?" },
        ]),
      })
    );
  });

  it("should work without taskId", async () => {
    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      body: JSON.stringify({
        message: "Quick question",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);

    // Verify no messages were persisted
    const messages = await db.chatMessage.findMany();
    expect(messages).toHaveLength(0);
  });
});

describe("Integration: PUT /api/agent", () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testSwarm: any;
  let testRepository: any;

  beforeEach(async () => {
    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test-put-agent@example.com",
        name: "Test PUT Agent User",
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test PUT Workspace",
        slug: "test-put-agent-workspace",
        ownerId: testUser.id,
      },
    });

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: "Test PUT Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    // Create test swarm
    testSwarm = await db.swarm.create({
      data: {
        name: "test-swarm",
        workspaceId: testWorkspace.id,
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-swarm-key",
      },
    });

    // Create test repository
    testRepository = await db.repository.create({
      data: {
        workspaceId: testWorkspace.id,
        repositoryUrl: "https://github.com/test/repo",
        name: "test-repo",
      },
    });

    // Mock middleware context
    vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue({
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
      },
      requestId: "test-req-123",
    } as any);

    vi.mocked(middlewareUtils.requireAuth).mockReturnValue({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
    });

    // Mock encryption service
    const mockEncryptionService = {
      decryptField: vi.fn().mockReturnValue("decrypted-swarm-key"),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

    // Mock repository helpers
    vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue(testRepository);

    // Mock GitHub PAT
    vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
      username: "testuser",
      token: "github-pat-token",
    } as any);

    // Mock AI tools
    vi.mocked(askToolsLib.askTools).mockReturnValue({
      get_learnings: {} as any,
      ask_question: {} as any,
      analyze_code: {} as any,
      web_search: {} as any,
    });

    // Mock AI SDK
    vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("anthropic-api-key");
    vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3-5-sonnet" } as any);

    const mockStreamResponse = {
      toUIMessageStreamResponse: vi.fn().mockReturnValue(
        new Response("stream-data", { status: 200 })
      ),
    };
    vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);
  });

  afterEach(async () => {
    // Cleanup test data
    await db.chatMessage.deleteMany({
      where: { taskId: testTask.id },
    });
    await db.repository.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.swarm.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.task.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspaceMember.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspace.deleteMany({
      where: { id: testWorkspace.id },
    });
    await db.user.deleteMany({
      where: { id: testUser.id },
    });

    vi.clearAllMocks();
  });

  it("should allow workspace owner to send messages", async () => {
    const message = "Analyze this code";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);

    // Verify message was persisted
    const savedMessages = await db.chatMessage.findMany({
      where: { taskId: testTask.id },
    });

    expect(savedMessages).toHaveLength(1);
    expect(savedMessages[0].message).toBe(message);
    expect(savedMessages[0].role).toBe(ChatRole.USER);
  });

  it("should allow workspace member to send messages", async () => {
    // Create another user as member
    const memberUser = await db.user.create({
      data: {
        email: "member@example.com",
        name: "Member User",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: memberUser.id,
        role: "DEVELOPER",
      },
    });

    // Update mock to use member user
    vi.mocked(middlewareUtils.requireAuth).mockReturnValue({
      id: memberUser.id,
      email: memberUser.email,
      name: memberUser.name,
    });

    const message = "Member's question";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);

    // Verify message was persisted
    const savedMessages = await db.chatMessage.findMany({
      where: { taskId: testTask.id },
    });

    expect(savedMessages).toHaveLength(1);
    expect(savedMessages[0].message).toBe(message);

    // Cleanup
    await db.workspaceMember.deleteMany({
      where: { userId: memberUser.id },
    });
    await db.user.deleteMany({
      where: { id: memberUser.id },
    });
  });

  it("should reject non-member users", async () => {
    // Create another user who is not a member
    const nonMemberUser = await db.user.create({
      data: {
        email: "nonmember@example.com",
        name: "Non Member User",
      },
    });

    // Update mock to use non-member user
    vi.mocked(middlewareUtils.requireAuth).mockReturnValue({
      id: nonMemberUser.id,
      email: nonMemberUser.email,
      name: nonMemberUser.name,
    });

    const message = "Non-member's question";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(403);

    // Verify no message was persisted
    const savedMessages = await db.chatMessage.findMany({
      where: { taskId: testTask.id },
    });

    expect(savedMessages).toHaveLength(0);

    // Cleanup
    await db.user.deleteMany({
      where: { id: nonMemberUser.id },
    });
  });

  it("should reject cross-workspace task access", async () => {
    // Create another workspace
    const otherWorkspace = await db.workspace.create({
      data: {
        name: "Other Workspace",
        slug: "other-workspace",
        ownerId: testUser.id,
      },
    });

    // Create task in other workspace
    const otherTask = await db.task.create({
      data: {
        title: "Other Task",
        workspaceId: otherWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    const message = "Cross-workspace attempt";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: otherTask.id, // Task from different workspace
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("Task not found");

    // Cleanup
    await db.task.deleteMany({
      where: { workspaceId: otherWorkspace.id },
    });
    await db.workspace.deleteMany({
      where: { id: otherWorkspace.id },
    });
  });

  it("should handle chat history in streaming", async () => {
    const history = [
      { role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ];

    const message = "Follow-up question";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
        history,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);

    // Verify streamText was called with history
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          { role: "user", content: "Previous question" },
          { role: "assistant", content: "Previous answer" },
          { role: "user", content: message },
        ]),
      })
    );
  });

  it("should initialize tools with correct parameters", async () => {
    const message = "Analyze code";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    await PUT(request);

    // Verify askTools was called with correct parameters
    expect(askToolsLib.askTools).toHaveBeenCalledWith(
      "http://localhost:3355",
      "decrypted-swarm-key",
      testRepository.repositoryUrl,
      "github-pat-token",
      "anthropic-api-key"
    );
  });

  it("should reject workspace without swarm configuration", async () => {
    // Delete swarm
    await db.swarm.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });

    const message = "Test message";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("Swarm not found");
  });

  it("should reject workspace without repository", async () => {
    // Delete repository
    await db.repository.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });

    vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue(null);

    const message = "Test message";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("Repository URL not configured");
  });

  it("should reject user without GitHub PAT", async () => {
    vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue(null);

    const message = "Test message";

    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "PUT",
      body: JSON.stringify({
        message,
        workspaceSlug: testWorkspace.slug,
        taskId: testTask.id,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("GitHub PAT not found");
  });
});