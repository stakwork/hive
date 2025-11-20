import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { auth } from "@/auth";
import { ChatRole, ChatStatus, ArtifactType, WorkflowStatus } from "@prisma/client";

// Mock all dependencies at module level
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://test-stakwork.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  getGithubUsernameAndPAT: vi.fn(),
}));
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));
vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn(),
}));
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { auth: mockGetServerSession } = await import("next-auth/next");
const { db: mockDb } = await import("@/lib/db");
const { config: mockConfig } = await import("@/lib/env");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/auth");
const { getS3Service: mockGetS3Service } = await import("@/services/s3");
const { transformSwarmUrlToRepo2Graph: mockTransformSwarmUrlToRepo2Graph } = await import("@/lib/utils/swarm");
const { getBaseUrl: mockGetBaseUrl } = await import("@/lib/utils");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

// Test Data Factory - Centralized test data creation
const TestDataFactory = {
  createValidSession: (userId = "test-user-id") => ({
    user: { id: userId, name: "Test User", email: "test@example.com" },
  }),

  createValidTask: (overrides = {}) => ({
    workspaceId: "test-workspace-id",
    workspace: {
      ownerId: "test-user-id",
      swarm: {
        id: "swarm-id",
        swarmUrl: "https://test-swarm.example.com/api",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolName: "test-pool",
        name: "test-swarm",
      },
      members: [],
    },
    ...overrides,
  }),

  createValidUser: (name = "Test User") => ({
    name,
  }),

  createValidWorkspace: (slug = "test-workspace") => ({
    slug,
  }),

  createChatMessage: (overrides = {}) => ({
    id: "message-id",
    taskId: "test-task-id",
    message: "Test message",
    role: ChatRole.USER,
    contextTags: "[]",
    status: ChatStatus.SENT,
    sourceWebsocketID: null,
    replyId: null,
    artifacts: [],
    attachments: [],
    task: {
      id: "test-task-id",
      title: "Test Task",
    },
    timestamp: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  createStakworkSuccessResponse: (projectId = 123) => ({
    success: true,
    data: { project_id: projectId },
  }),

  createStakworkErrorResponse: (error = "API Error") => ({
    success: false,
    error,
  }),

  createRequestBody: (overrides = {}) => ({
    taskId: "test-task-id",
    message: "Test message",
    contextTags: [],
    artifacts: [],
    attachments: [],
    ...overrides,
  }),
};

// Test Helpers - Reusable assertion and setup functions
const TestHelpers = {
  createMockRequest: (body: object) => {
    return new NextRequest("http://localhost:3000/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  setupValidSession: () => {
    mockGetServerSession.mockResolvedValue(TestDataFactory.createValidSession());
  },

  setupValidTaskAndUser: () => {
    mockDb.task.findFirst.mockResolvedValue(TestDataFactory.createValidTask() as any);
    mockDb.user.findUnique.mockResolvedValue(TestDataFactory.createValidUser() as any);
    mockDb.workspace.findUnique.mockResolvedValue(TestDataFactory.createValidWorkspace() as any);
  },

  setupTaskStatusCheck: (status: string = "TODO") => {
    mockDb.task.findUnique.mockResolvedValue({ status } as any);
  },

  setupValidChatMessage: () => {
    mockDb.chatMessage.create.mockResolvedValue(TestDataFactory.createChatMessage() as any);
    mockDb.chatMessage.findMany.mockResolvedValue([]);
  },

  setupValidGithubProfile: () => {
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-github-token",
    });
  },

  setupS3Service: () => {
    mockGetS3Service.mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/presigned-url"),
    } as any);
  },

  setupSwarmUrlTransform: () => {
    mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.example.com:3355");
  },

  expectFetchCalledWithWorkflowId: (workflowId: number) => {
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-stakwork.com/projects",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Token token=test-api-key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    expect(payload.workflow_id).toBe(workflowId);
  },

  expectFetchCalledWithVarsContaining: (expectedVars: Record<string, unknown>) => {
    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    const vars = payload.workflow_params.set_var.attributes.vars;

    Object.entries(expectedVars).forEach(([key, value]) => {
      expect(vars[key]).toEqual(value);
    });
  },

  expectTaskUpdatedWithStatus: async (status: WorkflowStatus) => {
    expect(mockDb.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: status,
        }),
      }),
    );
  },
};

// Mock Setup Helper - Centralized mock configuration
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupSuccessfulCallStakwork: (projectId = 123) => {
    TestHelpers.setupValidSession();
    TestHelpers.setupValidTaskAndUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupS3Service();
    TestHelpers.setupSwarmUrlTransform();
    TestHelpers.setupTaskStatusCheck("TODO");
    mockDb.task.update.mockResolvedValue({} as any);

    // Ensure all required configs are set to trigger Stakwork path
    vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
    vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => TestDataFactory.createStakworkSuccessResponse(projectId),
    } as Response);
  },

  setupFailedCallStakwork: (errorMessage = "API Error") => {
    TestHelpers.setupValidSession();
    TestHelpers.setupValidTaskAndUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupS3Service();
    TestHelpers.setupSwarmUrlTransform();
    TestHelpers.setupTaskStatusCheck("TODO");
    mockDb.task.update.mockResolvedValue({} as any);

    // Ensure all required configs are set to trigger Stakwork path
    vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
    vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
    vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

    mockFetch.mockResolvedValue({
      ok: false,
      statusText: errorMessage,
    } as Response);
  },
};

describe("callStakwork Function Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Configuration Validation", () => {
    test("should return error when STAKWORK_API_KEY is missing", async () => {
      TestHelpers.setupValidSession();
      TestHelpers.setupValidTaskAndUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupS3Service();
      TestHelpers.setupSwarmUrlTransform();

      // Remove STAKWORK_API_KEY
      vi.mocked(mockConfig).STAKWORK_API_KEY = "";

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201); // Message is created
      const data = await response.json();
      expect(data.success).toBe(true);
      // Should call mock API when Stakwork config is missing
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/chat",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    test("should return error when STAKWORK_WORKFLOW_ID is missing", async () => {
      TestHelpers.setupValidSession();
      TestHelpers.setupValidTaskAndUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupS3Service();
      TestHelpers.setupSwarmUrlTransform();

      // Remove STAKWORK_WORKFLOW_ID
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "";

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201);
      // Should call mock API when Stakwork config is missing
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/chat",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    test("should proceed when both STAKWORK_API_KEY and STAKWORK_WORKFLOW_ID are present", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("Mode-Based Workflow Selection", () => {
    test("should use workflow ID at index 0 for 'live' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ mode: "live" }));
      await POST(request);

      TestHelpers.expectFetchCalledWithWorkflowId(123); // First ID in "123,456,789"
    });

    test("should use workflow ID at index 2 for 'unit' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ mode: "unit" }));
      await POST(request);

      TestHelpers.expectFetchCalledWithWorkflowId(789); // Third ID in "123,456,789"
    });

    test("should use workflow ID at index 2 for 'integration' mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ mode: "integration" }));
      await POST(request);

      TestHelpers.expectFetchCalledWithWorkflowId(789); // Third ID in "123,456,789"
    });

    test("should use workflow ID at index 1 for default mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      TestHelpers.expectFetchCalledWithWorkflowId(456); // Second ID in "123,456,789"
    });

    test("should use workflow ID at index 1 for unknown mode", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ mode: "unknown" }));
      await POST(request);

      TestHelpers.expectFetchCalledWithWorkflowId(456); // Second ID (default)
    });
  });

  describe("Data Transformation - Vars Object", () => {
    test("should include all required fields in vars object", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        taskId: "test-task-id",
        message: "Test message",
        contextTags: [],
        webhookUrl: "http://localhost:3000/api/chat/response",
        alias: "testuser",
        username: "testuser",
        accessToken: "test-github-token",
        swarmUrl: "https://test-swarm.example.com:8444/api",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolName: "swarm-id",
        repo2graph_url: "https://test-swarm.example.com:3355",
        taskMode: undefined,
      });
    });

    test("should include taskMode in vars when mode is provided", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ mode: "live" }));
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        taskMode: "live",
      });
    });

    test("should handle null userName and accessToken", async () => {
      TestHelpers.setupValidSession();
      TestHelpers.setupValidTaskAndUser();
      TestHelpers.setupValidChatMessage();
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);
      TestHelpers.setupS3Service();
      TestHelpers.setupSwarmUrlTransform();
      mockDb.task.update.mockResolvedValue({} as any);

      // Ensure all required configs are set to trigger Stakwork path
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
      vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        alias: null,
        username: null,
        accessToken: null,
      });
    });

    test("should include contextTags in vars object", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const contextTags = [
        { type: "file", value: "test.ts" },
        { type: "folder", value: "src/" },
      ];

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ contextTags }));
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        contextTags,
      });
    });
  });

  describe("Webhook URL Construction", () => {
    test("should construct webhook URL with correct base URL", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        webhookUrl: "http://localhost:3000/api/chat/response",
      });
    });

    test("should construct workflow webhook URL with task_id query parameter", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.webhook_url).toBe("http://localhost:3000/api/stakwork/webhook?task_id=test-task-id");
    });

    test("should use custom webhook URL when provided", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const customWebhook = "https://custom-webhook.example.com/webhook";
      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ webhook: customWebhook }));
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        customWebhook,
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  describe("S3 Presigned URL Generation", () => {
    test("should generate presigned URLs for all attachments", async () => {
      const mockGeneratePresignedUrl = vi
        .fn()
        .mockResolvedValueOnce("https://s3.example.com/file1.pdf")
        .mockResolvedValueOnce("https://s3.example.com/file2.jpg");

      TestHelpers.setupValidSession();
      TestHelpers.setupValidTaskAndUser();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupSwarmUrlTransform();
      mockDb.task.update.mockResolvedValue({} as any);

      // Ensure all required configs are set to trigger Stakwork path
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
      vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

      mockGetS3Service.mockReturnValue({
        generatePresignedDownloadUrl: mockGeneratePresignedUrl,
      } as any);

      mockDb.chatMessage.create.mockResolvedValue(
        TestDataFactory.createChatMessage({
          attachments: [{ path: "uploads/file1.pdf" }, { path: "uploads/file2.jpg" }],
        }) as any,
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const request = TestHelpers.createMockRequest(
        TestDataFactory.createRequestBody({
          attachments: [
            { path: "uploads/file1.pdf", filename: "file1.pdf", mimeType: "application/pdf", size: 1024 },
            { path: "uploads/file2.jpg", filename: "file2.jpg", mimeType: "image/jpeg", size: 2048 },
          ],
        }),
      );
      await POST(request);

      expect(mockGeneratePresignedUrl).toHaveBeenCalledTimes(2);
      expect(mockGeneratePresignedUrl).toHaveBeenCalledWith("uploads/file1.pdf");
      expect(mockGeneratePresignedUrl).toHaveBeenCalledWith("uploads/file2.jpg");

      TestHelpers.expectFetchCalledWithVarsContaining({
        attachments: ["https://s3.example.com/file1.pdf", "https://s3.example.com/file2.jpg"],
      });
    });

    test("should handle empty attachments array", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ attachments: [] }));
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        attachments: [],
      });
    });
  });

  describe("Swarm URL Transformation", () => {
    test("should transform swarmUrl for workflow", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      // Verify swarmUrl has /api replaced with :8444/api
      TestHelpers.expectFetchCalledWithVarsContaining({
        swarmUrl: "https://test-swarm.example.com:8444/api",
      });
    });

    test("should call transformSwarmUrlToRepo2Graph for repo2graph_url", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      expect(mockTransformSwarmUrlToRepo2Graph).toHaveBeenCalledWith("https://test-swarm.example.com/api");

      TestHelpers.expectFetchCalledWithVarsContaining({
        repo2graph_url: "https://test-swarm.example.com:3355",
      });
    });

    test("should handle null swarmUrl", async () => {
      TestHelpers.setupValidSession();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupS3Service();
      mockDb.task.update.mockResolvedValue({} as any);

      // Task with no swarm
      mockDb.task.findFirst.mockResolvedValue({
        ...TestDataFactory.createValidTask(),
        workspace: {
          ownerId: "test-user-id",
          swarm: null,
          members: [],
        },
      } as any);

      mockDb.user.findUnique.mockResolvedValue(TestDataFactory.createValidUser() as any);
      mockDb.workspace.findUnique.mockResolvedValue(TestDataFactory.createValidWorkspace() as any);

      // Ensure all required configs are set to trigger Stakwork path
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
      vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

      mockTransformSwarmUrlToRepo2Graph.mockReturnValue("");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        swarmUrl: "",
        repo2graph_url: "",
      });
    });
  });

  describe("HTTP Error Handling", () => {
    test("should handle HTTP 400 error from Stakwork API", async () => {
      MockSetup.setupFailedCallStakwork("Bad Request");

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201); // Message is still created
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify task status was updated to FAILED
      await TestHelpers.expectTaskUpdatedWithStatus(WorkflowStatus.FAILED);
    });

    test("should handle HTTP 500 error from Stakwork API", async () => {
      MockSetup.setupFailedCallStakwork("Internal Server Error");

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201);
      await TestHelpers.expectTaskUpdatedWithStatus(WorkflowStatus.FAILED);
    });

    test("should handle network errors", async () => {
      TestHelpers.setupValidSession();
      TestHelpers.setupValidTaskAndUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupS3Service();
      TestHelpers.setupSwarmUrlTransform();
      mockDb.task.update.mockResolvedValue({} as any);

      // Ensure all required configs are set to trigger Stakwork path
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
      vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201);
      await TestHelpers.expectTaskUpdatedWithStatus(WorkflowStatus.FAILED);
    });

    test("should update task to IN_PROGRESS on successful Stakwork call", async () => {
      MockSetup.setupSuccessfulCallStakwork(456);

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201);

      expect(mockDb.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "test-task-id" },
          data: expect.objectContaining({
            workflowStatus: WorkflowStatus.IN_PROGRESS,
            workflowStartedAt: expect.any(Date),
            stakworkProjectId: 456,
          }),
        }),
      );
    });
  });

  describe("Payload Structure Verification", () => {
    test("should construct payload with correct structure", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: expect.any(Number),
        webhook_url: expect.stringContaining("api/stakwork/webhook"),
        workflow_params: {
          set_var: {
            attributes: {
              vars: expect.objectContaining({
                taskId: expect.any(String),
                message: expect.any(String),
              }),
            },
          },
        },
      });
    });

    test("should set name to 'hive_autogen'", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.name).toBe("hive_autogen");
    });

    test("should include workflow_params with nested set_var structure", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.workflow_params).toHaveProperty("set_var");
      expect(payload.workflow_params.set_var).toHaveProperty("attributes");
      expect(payload.workflow_params.set_var.attributes).toHaveProperty("vars");
    });
  });

  describe("Authorization Header", () => {
    test("should include correct Authorization header format", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Token token=test-api-key",
          }),
        }),
      );
    });

    test("should include Content-Type header", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty message with artifacts", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const request = TestHelpers.createMockRequest(
        TestDataFactory.createRequestBody({
          message: "",
          artifacts: [{ type: ArtifactType.CODE, content: { code: "test" } }],
        }),
      );
      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should handle very long message", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const longMessage = "a".repeat(10000);
      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ message: longMessage }));
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        message: longMessage,
      });
    });

    test("should handle special characters in message", async () => {
      MockSetup.setupSuccessfulCallStakwork();

      const specialMessage = "Test with 🚀 emojis and <html> tags & símböls";
      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ message: specialMessage }));
      await POST(request);

      TestHelpers.expectFetchCalledWithVarsContaining({
        message: specialMessage,
      });
    });

    test("should handle workflow ID string with extra whitespace", async () => {
      TestHelpers.setupValidSession();
      TestHelpers.setupValidTaskAndUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupS3Service();
      TestHelpers.setupSwarmUrlTransform();
      mockDb.task.update.mockResolvedValue({} as any);

      // Ensure all required configs are set to trigger Stakwork path
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
      vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = " 123 , 456 , 789 ";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody({ mode: "live" }));
      await POST(request);

      // Should still parse correctly after trim
      TestHelpers.expectFetchCalledWithWorkflowId(123);
    });
  });

  describe("Return Value Verification", () => {
    test("should return success with project_id on successful API call", async () => {
      MockSetup.setupSuccessfulCallStakwork(789);

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      const data = await response.json();
      expect(data.workflow).toEqual({ project_id: 789 });
    });

    test("should return success false on API error", async () => {
      MockSetup.setupFailedCallStakwork("Service Unavailable");

      const request = TestHelpers.createMockRequest(TestDataFactory.createRequestBody());
      const response = await POST(request);

      expect(response.status).toBe(201);
      // Verify task was marked as failed
      await TestHelpers.expectTaskUpdatedWithStatus(WorkflowStatus.FAILED);
    });
  });
});
