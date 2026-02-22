import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/workspaces/[slug]/logs-agent/route";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    stakworkRun: {
      findMany: vi.fn(),
    },
  },
}));

// Mock encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(),
    })),
  },
}));

// Mock swarm access helpers
vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Mock middleware utils
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

const { getServerSession: mockGetServerSession } = await import("next-auth/next");
const { db: mockDb } = await import("@/lib/db");
const { EncryptionService: mockEncryptionService } = await import("@/lib/encryption");
const {
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
  getSwarmAccessByWorkspaceId: mockGetSwarmAccessByWorkspaceId,
} = await import("@/lib/helpers/swarm-access");
const {
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
} = await import("@/lib/middleware/utils");

// Test Data Factories
const TestDataFactory = {
  createValidSession: (userId: string = "user-123") => ({
    user: { id: userId, email: "test@example.com", name: "Test User" },
  }),

  createWorkspaceRow: (
    id: string = "workspace-123",
    stakworkApiKey: string | null = "encrypted-key",
  ) => ({
    id,
    stakworkApiKey,
  }),

  createStakworkRun: (
    projectId: number | null,
    type: string = "GENERATE",
    status: string = "COMPLETED",
    featureTitle: string | null = "Test Feature",
  ) => ({
    projectId,
    type,
    status,
    createdAt: new Date("2026-02-20T10:00:00Z"),
    feature: featureTitle ? { title: featureTitle } : null,
    agentLogs: [],
  }),

  createSwarmAccessSuccess: () => ({
    success: true,
    data: {
      swarmUrl: "http://localhost:3355",
      swarmApiKey: "test-api-key",
      swarmName: "swarm38",
    },
  }),

  createEncryptedKey: () => ({
    data: "encrypted-data",
    iv: "iv-data",
    tag: "tag-data",
    keyId: "key-1",
    version: 1,
    encryptedAt: "2026-02-20T10:00:00Z",
  }),
};

// Test Helpers
const TestHelpers = {
  createPostRequest: (slug: string, body: { prompt: string; sessionId?: string }) => {
    return new NextRequest(`http://localhost:3000/api/workspaces/${slug}/logs-agent`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  setupAuthenticatedUser: (userId: string = "user-123") => {
    (mockGetServerSession as Mock).mockResolvedValue(TestDataFactory.createValidSession(userId));
    const mockContext = { user: { id: userId } };
    (mockGetMiddlewareContext as Mock).mockReturnValue(mockContext);
    (mockRequireAuth as Mock).mockReturnValue({ id: userId });
  },

  setupWorkspaceSwarmAccess: () => {
    (mockGetWorkspaceSwarmAccess as Mock).mockResolvedValue(
      TestDataFactory.createSwarmAccessSuccess(),
    );
  },

  setupWorkspaceQuery: (
    workspaceRow: { id: string; stakworkApiKey: string | null } | null,
  ) => {
    (mockDb.workspace.findFirst as Mock).mockResolvedValue(workspaceRow);
  },

  setupStakworkRuns: (runs: any[]) => {
    (mockDb.stakworkRun.findMany as Mock).mockResolvedValue(runs);
  },

  setupEncryptionService: (decryptedValue: string | null, shouldThrow: boolean = false) => {
    const decryptField = vi.fn();
    if (shouldThrow) {
      decryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });
    } else if (decryptedValue !== null) {
      decryptField.mockReturnValue(decryptedValue);
    }
    (mockEncryptionService.getInstance as Mock).mockReturnValue({ decryptField });
  },

  setupFetchMocks: () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "req-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "completed",
          result: { final_answer: "Test answer", sessionId: "session-123" },
        }),
      }) as Mock;
  },

  expectSuccessResponse: async (response: Response) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("answer");
    expect(data).toHaveProperty("sessionId");
    return data;
  },

  expectErrorResponse: async (response: Response, status: number, errorMessage?: string) => {
    expect(response.status).toBe(status);
    const data = await response.json();
    expect(data).toHaveProperty("error");
    if (errorMessage) {
      expect(data.error).toContain(errorMessage);
    }
    return data;
  },

  extractFetchBody: (fetchMock: Mock, callIndex: number = 0): any => {
    const call = fetchMock.mock.calls[callIndex];
    if (!call || !call[1]?.body) return null;
    return JSON.parse(call[1].body);
  },
};

describe("POST /api/workspaces/[slug]/logs-agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 if user is not authenticated", async () => {
      (mockGetServerSession as Mock).mockResolvedValue(null);
      const mockContext = { user: null, authStatus: "unauthenticated" };
      (mockGetMiddlewareContext as Mock).mockReturnValue(mockContext);
      // requireAuth returns NextResponse when unauthorized
      const unauthorizedResponse = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
      (mockRequireAuth as Mock).mockReturnValue(unauthorizedResponse);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectErrorResponse(response, 401);
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      TestHelpers.setupWorkspaceSwarmAccess();
    });

    test("should return 400 if prompt is missing", async () => {
      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectErrorResponse(response, 400, "prompt is required");
    });

    test("should return 400 if slug is missing", async () => {
      const request = TestHelpers.createPostRequest("", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "" }) });

      await TestHelpers.expectErrorResponse(response, 400, "Workspace slug is required");
    });
  });

  describe("stakworkApiKey and stakworkRuns enrichment", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      TestHelpers.setupWorkspaceSwarmAccess();
      TestHelpers.setupFetchMocks();
    });

    test("should omit stakworkApiKey when workspace has no key", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", null);
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupStakworkRuns([]);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body).not.toHaveProperty("stakworkApiKey");
    });

    test("should omit stakworkApiKey when decryption throws", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", "encrypted-key");
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupEncryptionService(null, true); // Throws error
      TestHelpers.setupStakworkRuns([]);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body).not.toHaveProperty("stakworkApiKey");
    });

    test("should omit stakworkRuns when no runs exist", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", "encrypted-key");
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupEncryptionService("decrypted-key");
      TestHelpers.setupStakworkRuns([]);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body).not.toHaveProperty("stakworkRuns");
    });

    test("should include all 25 runs when exactly 25 exist with non-null projectId", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", "encrypted-key");
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupEncryptionService("decrypted-key");

      const runs = Array.from({ length: 25 }, (_, i) =>
        TestDataFactory.createStakworkRun(2000 + i, "ARCHITECTURE", "COMPLETED", "Feature C"),
      );
      TestHelpers.setupStakworkRuns(runs);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body.stakworkRuns).toHaveLength(25);
    });

    test("should omit both fields when workspace is not found", async () => {
      TestHelpers.setupWorkspaceQuery(null);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body).not.toHaveProperty("stakworkApiKey");
      expect(body).not.toHaveProperty("stakworkRuns");
    });

    test("should format runs with correct structure including feature title", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", "encrypted-key");
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupEncryptionService("decrypted-key");

      const runs = [
        TestDataFactory.createStakworkRun(5000, "GENERATE", "COMPLETED", "Auth Flow"),
        TestDataFactory.createStakworkRun(5001, "ARCHITECTURE", "FAILED", null), // No feature
      ];
      TestHelpers.setupStakworkRuns(runs);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body.stakworkRuns).toHaveLength(2);
      expect(body.stakworkRuns[0]).toMatchObject({
        projectId: 5000,
        type: "GENERATE",
        status: "COMPLETED",
        feature: "Auth Flow",
        createdAt: "2026-02-20T10:00:00.000Z",
      });
      expect(body.stakworkRuns[1]).toMatchObject({
        projectId: 5001,
        type: "ARCHITECTURE",
        status: "FAILED",
        feature: null,
        createdAt: "2026-02-20T10:00:00.000Z",
      });
    });

    test("should only include runs with non-null projectId", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", "encrypted-key");
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupEncryptionService("decrypted-key");

      // Mock returns only non-null projectId runs (Prisma filters at DB level)
      const runs = [
        TestDataFactory.createStakworkRun(6000, "GENERATE", "COMPLETED", "Feature D"),
        TestDataFactory.createStakworkRun(6001, "REVIEW", "COMPLETED", "Feature F"),
      ];
      TestHelpers.setupStakworkRuns(runs);

      const request = TestHelpers.createPostRequest("test-workspace", { prompt: "test" });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body.stakworkRuns).toHaveLength(2);
      expect(body.stakworkRuns[0].projectId).toBe(6000);
      expect(body.stakworkRuns[1].projectId).toBe(6001);
    });
  });

  describe("Existing functionality preservation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      TestHelpers.setupWorkspaceSwarmAccess();
      TestHelpers.setupFetchMocks();
    });

    test("should include all standard fields in request body", async () => {
      const workspaceRow = TestDataFactory.createWorkspaceRow("ws-1", null);
      TestHelpers.setupWorkspaceQuery(workspaceRow);
      TestHelpers.setupStakworkRuns([]);

      const request = TestHelpers.createPostRequest("test-workspace", {
        prompt: "test prompt",
        sessionId: "session-abc",
      });
      const response = await POST(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response);

      const fetchMock = global.fetch as Mock;
      const body = TestHelpers.extractFetchBody(fetchMock, 0);

      expect(body).toMatchObject({
        prompt: "test prompt",
        swarmName: "swarm38",
        sessionId: "session-abc",
        model: "haiku",
        sessionConfig: {
          truncateToolResults: false,
          maxToolResultLines: 200,
          maxToolResultChars: 2000,
        },
      });
    });
  });
});
