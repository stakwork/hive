import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workflow/prompts/route";
import { GET as GET_BY_ID, PUT, DELETE } from "@/app/api/workflow/prompts/[id]/route";
import { GET as GET_VERSIONS } from "@/app/api/workflow/prompts/[id]/versions/route";
import { GET as GET_VERSION_BY_ID } from "@/app/api/workflow/prompts/[id]/versions/[versionId]/route";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  getMockedSession,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";

// Mock external dependencies
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_API_KEY: "test-stakwork-key-123",
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
  isSwarmFakeModeEnabled: vi.fn(() => false),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

import { isDevelopmentMode } from "@/lib/runtime";
import { config } from "@/config/env";

const mockGetServerSession = getMockedSession();
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

// Mock global fetch
global.fetch = vi.fn();
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("POST /api/workflow/prompts Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    // Set default for isDevelopmentMode
    mockIsDevelopmentMode.mockReturnValue(false);

    // Create test users
    testUser = await createTestUser();
    otherUser = await createTestUser();

    // Create stakwork workspace
    stakworkWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      name: "Stakwork",
      slug: "stakwork",
    });

    // Add test user as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: stakworkWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Test Prompt", value: "Test value" }),
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Test Prompt", value: "Test value" }),
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Test Prompt", value: "Test value" }),
      });

      const response = await POST(request);
      await expectError(response, "Invalid user session", 401);
    });

    test("allows authenticated user with valid session", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-123", name: "Test Prompt", value: "Test value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Test Prompt", value: "Test value" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Test Prompt", value: "Test value" }),
      });

      const response = await POST(request);
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace owner to create prompt", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-456", name: "Owner Prompt", value: "Owner value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Owner Prompt", value: "Owner value" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });

    test("allows workspace member (DEVELOPER role) to create prompt", async () => {
      const memberUser = await createTestUser({ name: "Developer User" });

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
          data: { id: "prompt-789", name: "Dev Prompt", value: "Dev value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Dev Prompt", value: "Dev value" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-dev", name: "Dev Mode Prompt", value: "Dev value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Dev Mode Prompt", value: "Dev value" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when name is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ value: "Test value" }),
      });

      const response = await POST(request);
      await expectError(response, "Name and value are required", 400);
    });

    test("returns 400 when value is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Test Prompt" }),
      });

      const response = await POST(request);
      await expectError(response, "Name and value are required", 400);
    });

    test("returns 400 when both name and value are missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      await expectError(response, "Name and value are required", 400);
    });

    test("accepts valid prompt with name and value", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-valid", name: "Valid Prompt", value: "Valid value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Valid Prompt", value: "Valid value" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.name).toBe("Valid Prompt");
      expect(data.data.value).toBe("Valid value");
    });

    test("accepts optional description field", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-desc",
            name: "Prompt with description",
            value: "Value",
            description: "Test description",
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({
          name: "Prompt with description",
          value: "Value",
          description: "Test description",
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.description).toBe("Test description");
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL and headers", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-123", name: "API Test", value: "API value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "API Test", value: "API value" }),
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("sends correct body to Stakwork API", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-body", name: "Body Test", value: "Body value" },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({
          name: "Body Test",
          value: "Body value",
          description: "Body description",
        }),
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body).toEqual({
        name: "Body Test",
        value: "Body value",
        description: "Body description",
      });
    });

    test("handles successful Stakwork API response", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-success",
            name: "Success Prompt",
            value: "Success value",
            created_at: "2024-01-01T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Success Prompt", value: "Success value" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.id).toBe("prompt-success");
      expect(data.data.name).toBe("Success Prompt");
    });

    test("handles Stakwork API error with non-ok status", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Error Prompt", value: "Error value" }),
      });

      const response = await POST(request);
      await expectError(response, "Failed to create prompt", 500);
    });

    test("handles Stakwork API response with success: false", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Fail Prompt", value: "Fail value" }),
      });

      const response = await POST(request);
      await expectError(response, "Failed to create prompt", 400);
    });

    test("handles network errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Network Prompt", value: "Network value" }),
      });

      const response = await POST(request);
      await expectError(response, "Failed to create prompt", 500);
    });
  });

  describe("Edge Cases", () => {
    test("handles malformed JSON body", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: "invalid json{",
      });

      const response = await POST(request);
      await expectError(response, "Failed to create prompt", 500);
    });

    test("handles empty string values", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "", value: "" }),
      });

      const response = await POST(request);
      await expectError(response, "Name and value are required", 400);
    });

    test("handles very long prompt values", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-long",
            name: "Long Prompt",
            value: "x".repeat(10000),
          },
        }),
      } as Response);

      const longValue = "x".repeat(10000);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "Long Prompt", value: longValue }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.value).toBe(longValue);
    });

    test("handles special characters in prompt fields", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-special",
            name: "Special <>&\" Prompt",
            value: "Special \n\t\r value",
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts", {
        method: "POST",
        body: JSON.stringify({
          name: "Special <>&\" Prompt",
          value: "Special \n\t\r value",
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.name).toBe("Special <>&\" Prompt");
    });
  });
});

describe("GET /api/workflow/prompts Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to list prompts", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Pagination Tests", () => {
    test("retrieves prompts with default page 1", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [{ id: "p1", name: "Prompt 1" }],
            total: 1,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      const data = await expectSuccess(response, 200);
      expect(data.data.page).toBe(1);
    });

    test("retrieves prompts with specified page parameter", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts?page=3");

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("page=3"),
        expect.any(Object)
      );
    });
  });

  describe("Filtering Tests", () => {
    test("filters prompts by workflow_id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [{ id: "p1", workflow_id: "wf-123" }],
            total: 1,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?workflow_id=wf-123"
      );

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("workflow_id=wf-123"),
        expect.any(Object)
      );
    });

    test("includes usages when include_usages is true", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [{ id: "p1", usages: [{ id: "u1" }] }],
            total: 1,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?include_usages=true"
      );

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("include_usages=true"),
        expect.any(Object)
      );
    });

    test("combines multiple query parameters", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?page=2&workflow_id=wf-123&include_usages=true"
      );

      await GET(request);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("page=2");
      expect(fetchUrl).toContain("workflow_id=wf-123");
      expect(fetchUrl).toContain("include_usages=true");
    });

    test("filters prompts by name parameter", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [{ id: "p1", name: "Test Prompt" }],
            total: 1,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?search=test"
      );

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("search=test"),
        expect.any(Object)
      );
    });

    test("URL encodes search parameter correctly", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?search=test%20prompt"
      );

      await GET(request);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("search=test%20prompt");
    });

    test("handles special characters in search parameter", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const specialName = "test&prompt=special";
      const request = new NextRequest(
        `http://localhost:3000/api/workflow/prompts?search=${encodeURIComponent(specialName)}`
      );

      await GET(request);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain(`search=${encodeURIComponent(specialName)}`);
    });

    test("omits search parameter when not provided", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      await GET(request);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).not.toContain("search=");
    });

    test("handles empty search parameter", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?search="
      );

      await GET(request);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      // Empty search should not add the parameter to the URL
      expect(fetchUrl).not.toContain("search=");
    });

    test("combines search with other query parameters", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts?page=2&workflow_id=wf-123&include_usages=true&search=searchterm"
      );

      await GET(request);

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain("page=2");
      expect(fetchUrl).toContain("workflow_id=wf-123");
      expect(fetchUrl).toContain("include_usages=true");
      expect(fetchUrl).toContain("search=searchterm");
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL and headers", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: [],
            total: 0,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://api.stakwork.test/prompts"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("handles successful Stakwork API response with multiple prompts", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const mockPrompts = [
        { id: "p1", name: "Prompt 1", value: "Value 1" },
        { id: "p2", name: "Prompt 2", value: "Value 2" },
      ];
      const expectedPromptsCount = mockPrompts.length; // Should match the mocked response

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompts: mockPrompts,
            total: expectedPromptsCount,
            size: 10,
          },
        }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.prompts).toHaveLength(expectedPromptsCount);
      expect(data.data.total).toBe(expectedPromptsCount);
    });

    test("handles Stakwork API error responses", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      await expectError(response, "Failed to fetch prompts", 500);
    });

    test("handles network failures", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts");

      const response = await GET(request);
      await expectError(response, "Failed to fetch prompts", 500);
    });
  });
});

describe("GET /api/workflow/prompts/[id] Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123"
      );

      const response = await GET_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectUnauthorized(response);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when id is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts/");

      const response = await GET_BY_ID(request, {
        params: Promise.resolve({ id: "" }),
      });
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Retrieval Tests", () => {
    test("successfully retrieves prompt by id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-123",
            name: "Test Prompt",
            value: "Test value",
            created_at: "2024-01-01T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123"
      );

      const response = await GET_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.id).toBe("prompt-123");
    });

    test("handles non-existent prompt id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Prompt not found",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/nonexistent"
      );

      const response = await GET_BY_ID(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      await expectError(response, "Failed to fetch prompt", 404);
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-api", name: "API Test" },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-api"
      );

      await GET_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-api" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/prompt-api",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
          }),
        })
      );
    });
  });
});

describe("PUT /api/workflow/prompts/[id] Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

    testUser = await createTestUser();

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        {
          method: "PUT",
          body: JSON.stringify({ value: "Updated value" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectUnauthorized(response);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when value is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        {
          method: "PUT",
          body: JSON.stringify({}),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectError(response, "Value is required", 400);
    });

    test("returns 400 when id is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workflow/prompts/", {
        method: "PUT",
        body: JSON.stringify({ value: "Updated value" }),
      });

      const response = await PUT(request, {
        params: Promise.resolve({ id: "" }),
      });
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Update Tests", () => {
    test("successfully updates prompt value", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-123",
            value: "Updated value",
            updated_at: "2024-01-02T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        {
          method: "PUT",
          body: JSON.stringify({ value: "Updated value" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.value).toBe("Updated value");
    });

    test("updates prompt with optional description", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: "prompt-456",
            value: "New value",
            description: "New description",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-456",
        {
          method: "PUT",
          body: JSON.stringify({
            value: "New value",
            description: "New description",
          }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ id: "prompt-456" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.data.description).toBe("New description");
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL and body", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: "prompt-update", value: "Updated" },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-update",
        {
          method: "PUT",
          body: JSON.stringify({
            value: "Updated",
            description: "Updated description",
          }),
        }
      );

      await PUT(request, {
        params: Promise.resolve({ id: "prompt-update" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/prompt-update",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
          }),
        })
      );

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body).toEqual({
        value: "Updated",
        description: "Updated description",
      });
    });

    test("handles update failures from Stakwork API", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Prompt not found",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/nonexistent",
        {
          method: "PUT",
          body: JSON.stringify({ value: "New value" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      await expectError(response, "Failed to update prompt", 404);
    });
  });
});

describe("GET /api/workflow/prompts/[id]/versions Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to fetch version list", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompt_id: 123,
            prompt_name: "Test Prompt",
            versions: [
              { id: 1, version_number: 1, created_at: "2024-01-01T00:00:00Z", whodunnit: "user1" },
            ],
            current_version_id: 1,
            version_count: 1,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompt_id: 456,
            prompt_name: "Dev Prompt",
            versions: [],
            current_version_id: null,
            version_count: 0,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-456/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-456" }),
      });
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when prompt id is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts//versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "" }),
      });
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Version List Retrieval Tests", () => {
    test("returns version list successfully with multiple versions", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const mockVersions = [
        { id: 5, version_number: 5, created_at: "2024-01-05T00:00:00Z", whodunnit: "user1" },
        { id: 4, version_number: 4, created_at: "2024-01-04T00:00:00Z", whodunnit: "user2" },
        { id: 3, version_number: 3, created_at: "2024-01-03T00:00:00Z", whodunnit: "user1" },
        { id: 2, version_number: 2, created_at: "2024-01-02T00:00:00Z", whodunnit: null },
        { id: 1, version_number: 1, created_at: "2024-01-01T00:00:00Z", whodunnit: "user1" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompt_id: 789,
            prompt_name: "Multi-version Prompt",
            versions: mockVersions,
            current_version_id: 5,
            version_count: 5,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-789/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-789" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(5);
      expect(data.data.version_count).toBe(5);
      expect(data.data.current_version_id).toBe(5);
      expect(data.data.prompt_name).toBe("Multi-version Prompt");
    });

    test("handles single-version edge case", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompt_id: 111,
            prompt_name: "Single Version Prompt",
            versions: [
              { id: 1, version_number: 1, created_at: "2024-01-01T00:00:00Z", whodunnit: "user1" },
            ],
            current_version_id: 1,
            version_count: 1,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-111/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-111" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.versions).toHaveLength(1);
      expect(data.data.version_count).toBe(1);
    });

    test("handles version with null whodunnit", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompt_id: 222,
            prompt_name: "Null Whodunnit Prompt",
            versions: [
              { id: 2, version_number: 2, created_at: "2024-01-02T00:00:00Z", whodunnit: null },
              { id: 1, version_number: 1, created_at: "2024-01-01T00:00:00Z", whodunnit: "user1" },
            ],
            current_version_id: 2,
            version_count: 2,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-222/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-222" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.versions[0].whodunnit).toBeNull();
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL and headers", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            prompt_id: 333,
            prompt_name: "API Test",
            versions: [],
            current_version_id: null,
            version_count: 0,
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-333/versions"
      );

      await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-333" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/prompt-333/versions",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("handles Stakwork API error responses", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Prompt not found",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/nonexistent/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      await expectError(response, "Failed to fetch prompt versions", 404);
    });

    test("handles Stakwork API with success: false", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-fail/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-fail" }),
      });
      await expectError(response, "Failed to fetch prompt versions from Stakwork", 400);
    });

    test("handles network errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-network/versions"
      );

      const response = await GET_VERSIONS(request, {
        params: Promise.resolve({ id: "prompt-network" }),
      });
      await expectError(response, "Failed to fetch prompt versions", 500);
    });
  });
});

describe("GET /api/workflow/prompts/[id]/versions/[versionId] Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "1" }),
      });
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "1" }),
      });
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "1" }),
      });
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "1" }),
      });
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to fetch version detail", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 1,
            version_id: 1,
            version_number: 1,
            name: "Test Prompt",
            value: "This is the prompt content for version 1",
            description: "Test description",
            usage_notation: "@prompt-123",
            created_at: "2024-01-01T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "1" }),
      });
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 2,
            version_id: 2,
            version_number: 2,
            name: "Dev Prompt",
            value: "Dev mode content",
            description: "Dev description",
            usage_notation: "@dev-prompt",
            created_at: "2024-01-02T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-456/versions/2"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-456", versionId: "2" }),
      });
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when prompt id is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts//versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "", versionId: "1" }),
      });
      await expectError(response, "Prompt ID is required", 400);
    });

    test("returns 400 when version id is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "" }),
      });
      await expectError(response, "Version ID is required", 400);
    });
  });

  describe("Version Detail Retrieval Tests", () => {
    test("returns full version content successfully", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const samplePromptText = `You are a helpful AI assistant.
Your task is to analyze the following code and provide suggestions for improvement.

Consider:
- Code readability
- Performance optimization
- Best practices
- Security concerns

Be specific and actionable in your recommendations.`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 5,
            version_id: 5,
            version_number: 5,
            name: "Code Review Assistant",
            value: samplePromptText,
            description: "A prompt for code review assistance",
            usage_notation: "@code-review-v5",
            created_at: "2024-01-05T10:30:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-789/versions/5"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-789", versionId: "5" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.version_id).toBe(5);
      expect(data.data.version_number).toBe(5);
      expect(data.data.name).toBe("Code Review Assistant");
      expect(data.data.value).toBe(samplePromptText);
      expect(data.data.description).toBe("A prompt for code review assistance");
      expect(data.data.usage_notation).toBe("@code-review-v5");
    });

    test("handles version with minimal fields", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 1,
            version_id: 1,
            version_number: 1,
            name: "Minimal Prompt",
            value: "Simple prompt text",
            description: "",
            usage_notation: "@minimal",
            created_at: "2024-01-01T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-minimal/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-minimal", versionId: "1" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.description).toBe("");
    });

    test("handles version with long prompt value", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const longPromptValue = "A".repeat(5000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 3,
            version_id: 3,
            version_number: 3,
            name: "Long Prompt",
            value: longPromptValue,
            description: "A very long prompt",
            usage_notation: "@long-prompt",
            created_at: "2024-01-03T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-long/versions/3"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-long", versionId: "3" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.value).toHaveLength(5000);
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL and headers", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 2,
            version_id: 2,
            version_number: 2,
            name: "API Test Prompt",
            value: "API test content",
            description: "API test",
            usage_notation: "@api-test",
            created_at: "2024-01-02T00:00:00Z",
          },
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-333/versions/2"
      );

      await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-333", versionId: "2" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/prompt-333/versions/2",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("handles Stakwork API error when version not found", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Version not found",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123/versions/999"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-123", versionId: "999" }),
      });
      await expectError(response, "Failed to fetch prompt version", 404);
    });

    test("handles Stakwork API error when prompt not found", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Prompt not found",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/nonexistent/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "nonexistent", versionId: "1" }),
      });
      await expectError(response, "Failed to fetch prompt version", 404);
    });

    test("handles Stakwork API with success: false", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-fail/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-fail", versionId: "1" }),
      });
      await expectError(response, "Failed to fetch prompt version from Stakwork", 400);
    });

    test("handles network errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Connection timeout"));

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-network/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-network", versionId: "1" }),
      });
      await expectError(response, "Failed to fetch prompt version", 500);
    });

    test("handles Stakwork API server errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-error/versions/1"
      );

      const response = await GET_VERSION_BY_ID(request, {
        params: Promise.resolve({ id: "prompt-error", versionId: "1" }),
      });
      await expectError(response, "Failed to fetch prompt version", 500);
    });
  });
});

describe("DELETE /api/workflow/prompts/[id] Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let stakworkWorkspace: { id: string; slug: string };
  let otherUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    mockGetServerSession.mockReset();
    mockIsDevelopmentMode.mockReset();

    mockIsDevelopmentMode.mockReturnValue(false);

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectUnauthorized(response);
    });

    test("returns 401 when session user has no id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { email: "test@example.com" },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 403 when user is not a member of stakwork workspace", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      await expectForbidden(response, "not a member of stakwork workspace");
    });

    test("allows workspace member to delete prompt", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-123",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-123" }),
      });
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Development Mode Tests", () => {
    test("bypasses stakwork workspace check when in development mode", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-dev",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-dev" }),
      });
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when id is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "" }),
      });
      await expectError(response, "Prompt ID is required", 400);
    });
  });

  describe("Delete Tests", () => {
    test("successfully deletes prompt", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-delete-123",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-delete-123" }),
      });
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
    });

    test("handles non-existent prompt id", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Prompt not found",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/nonexistent",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      await expectError(response, "Failed to delete prompt", 404);
    });
  });

  describe("Stakwork API Integration Tests", () => {
    test("calls Stakwork API with correct URL and method", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-api",
        { method: "DELETE" }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: "prompt-api" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.test/prompts/prompt-api",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key-123",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("forwards Stakwork API error status", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-forbidden",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-forbidden" }),
      });
      await expectError(response, "Failed to delete prompt", 403);
    });

    test("handles Stakwork API with success: false", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: false,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-fail",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-fail" }),
      });
      await expectError(response, "Failed to delete prompt from Stakwork", 400);
    });

    test("handles network errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-network",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-network" }),
      });
      await expectError(response, "Failed to delete prompt", 500);
    });

    test("handles Stakwork API server errors", async () => {
      mockGetServerSession.mockResolvedValueOnce({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/workflow/prompts/prompt-error",
        { method: "DELETE" }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: "prompt-error" }),
      });
      await expectError(response, "Failed to delete prompt", 500);
    });
  });
});
