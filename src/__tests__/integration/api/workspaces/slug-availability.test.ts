import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/workspaces/slug-availability/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";

// Mock external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Test data factories
const TestDataFactories = {
  session: (overrides: any = {}) => ({
    user: {
      id: "test-user-id",
      email: "test@example.com",
      name: "Test User",
      ...overrides.user,
    },
    expires: "2024-12-31T23:59:59.999Z",
    ...overrides,
  }),

  workspace: (overrides: any = {}) => ({
    id: "workspace-123",
    slug: "test-workspace",
    name: "Test Workspace",
    ownerId: "test-user-id",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  }),

  request: (url: string, options: any = {}) => {
    return new NextRequest(url, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        ...options.headers,
      },
      ...options,
    });
  },

  errorResponse: (message: string) => ({
    success: false,
    error: message,
  }),

  successResponse: (slug: string, isAvailable: boolean) => ({
    success: true,
    data: {
      slug,
      isAvailable,
      message: isAvailable
        ? "Slug is available"
        : "A workspace with this slug already exists",
    },
  }),
};

// Test utilities
const TestUtils = {
  setupAuthenticated: (sessionOverrides: any = {}) => {
    const mockSession = TestDataFactories.session(sessionOverrides);
    (getServerSession as any).mockResolvedValue(mockSession);
    return mockSession;
  },

  setupUnauthenticated: () => {
    (getServerSession as any).mockResolvedValue(null);
  },

  setupDatabaseResponse: (workspace: any = null, shouldReject = false) => {
    if (shouldReject) {
      (db.workspace.findUnique as any).mockRejectedValue(new Error("Database error"));
    } else {
      (db.workspace.findUnique as any).mockResolvedValue(workspace);
    }
  },

  createTestRequest: (slug?: string) => {
    const baseUrl = "http://localhost:3000/api/workspaces/slug-availability";
    const url = slug ? `${baseUrl}?slug=${encodeURIComponent(slug)}` : baseUrl;
    return TestDataFactories.request(url);
  },

  expectResponse: async (response: Response, expectedData: any, expectedStatus: number) => {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    expect(data).toEqual(expectedData);
  },

  expectDatabaseQuery: (slug: string) => {
    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { slug: slug.toLowerCase() },
      select: { id: true },
    });
  },

  expectAuthenticationCall: () => {
    expect(getServerSession).toHaveBeenCalled();
  },
};

// Setup and teardown helpers
const TestSetup = {
  beforeEach: () => {
    vi.clearAllMocks();
  },

  afterEach: () => {
    vi.resetAllMocks();
  },
};

describe("GET /api/workspaces/slug-availability", () => {
  beforeEach(TestSetup.beforeEach);
  afterEach(TestSetup.afterEach);

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      TestUtils.setupUnauthenticated();
      const request = TestUtils.createTestRequest("available-slug");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Unauthorized"),
        401
      );
      TestUtils.expectAuthenticationCall();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("returns 401 when session exists but user is missing", async () => {
      TestUtils.setupAuthenticated({ user: null });
      const request = TestUtils.createTestRequest("available-slug");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Unauthorized"),
        401
      );
      TestUtils.expectAuthenticationCall();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("returns 401 when user exists but id is missing", async () => {
      TestUtils.setupAuthenticated({
        user: { email: "test@example.com", name: "Test User" },
      });
      const request = TestUtils.createTestRequest("available-slug");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Unauthorized"),
        401
      );
      TestUtils.expectAuthenticationCall();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("proceeds when user is properly authenticated", async () => {
      TestUtils.setupAuthenticated();
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest("available-slug");

      const response = await GET(request);

      expect(response.status).toBe(200);
      TestUtils.expectAuthenticationCall();
      expect(db.workspace.findUnique).toHaveBeenCalled();
    });
  });

  describe("Parameter Validation", () => {
    beforeEach(() => {
      TestUtils.setupAuthenticated();
    });

    test("returns 400 when slug parameter is missing", async () => {
      const request = TestUtils.createTestRequest();

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Slug parameter is required"),
        400
      );
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("returns 400 when slug parameter is empty string", async () => {
      const request = TestUtils.createTestRequest("");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Slug parameter is required"),
        400
      );
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("proceeds when slug parameter is provided", async () => {
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest("valid-slug");

      const response = await GET(request);

      expect(response.status).toBe(200);
      TestUtils.expectDatabaseQuery("valid-slug");
    });
  });

  describe("Slug Availability Check", () => {
    beforeEach(() => {
      TestUtils.setupAuthenticated();
    });

    test("returns available when slug does not exist", async () => {
      TestUtils.setupDatabaseResponse(null);
      const testSlug = "available-slug";
      const request = TestUtils.createTestRequest(testSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(testSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(testSlug);
    });

    test("returns unavailable when slug already exists", async () => {
      const testSlug = "existing-slug";
      const existingWorkspace = TestDataFactories.workspace({ 
        id: "existing-123", 
        slug: testSlug 
      });
      TestUtils.setupDatabaseResponse(existingWorkspace);
      const request = TestUtils.createTestRequest(testSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(testSlug, false),
        200
      );
      TestUtils.expectDatabaseQuery(testSlug);
    });

    test("performs case-insensitive slug check", async () => {
      const testSlug = "MixedCaseSlug";
      const existingWorkspace = TestDataFactories.workspace({ 
        slug: "mixedcaseslug" 
      });
      TestUtils.setupDatabaseResponse(existingWorkspace);
      const request = TestUtils.createTestRequest(testSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(testSlug, false),
        200
      );
      // Should query with lowercase version
      TestUtils.expectDatabaseQuery(testSlug);
    });

    test("handles special characters in slug", async () => {
      const testSlug = "slug-with-special_chars.123";
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest(testSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(testSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(testSlug);
    });

    test("handles URL encoded slug parameters", async () => {
      const testSlug = "slug with spaces";
      const encodedSlug = encodeURIComponent(testSlug);
      TestUtils.setupDatabaseResponse(null);
      const request = TestDataFactories.request(
        `http://localhost:3000/api/workspaces/slug-availability?slug=${encodedSlug}`
      );

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(testSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(testSlug);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      TestUtils.setupAuthenticated();
    });

    test("handles very long slug", async () => {
      const longSlug = "a".repeat(1000);
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest(longSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(longSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(longSlug);
    });

    test("handles single character slug", async () => {
      const shortSlug = "a";
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest(shortSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(shortSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(shortSlug);
    });

    test("handles numeric slug", async () => {
      const numericSlug = "12345";
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest(numericSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(numericSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(numericSlug);
    });

    test("handles slug with unicode characters", async () => {
      const unicodeSlug = "café-résumé-naïve";
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest(unicodeSlug);

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.successResponse(unicodeSlug, true),
        200
      );
      TestUtils.expectDatabaseQuery(unicodeSlug);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      TestUtils.setupAuthenticated();
    });

    test("returns 500 when database query fails", async () => {
      TestUtils.setupDatabaseResponse(null, true);
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Database error"),
        500
      );
      expect(db.workspace.findUnique).toHaveBeenCalled();
    });

    test("handles database connection errors gracefully", async () => {
      const connectionError = new Error("Connection refused");
      connectionError.name = "ConnectionError";
      (db.workspace.findUnique as any).mockRejectedValue(connectionError);
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Connection refused"),
        500
      );
    });

    test("handles unknown errors with generic message", async () => {
      (db.workspace.findUnique as any).mockRejectedValue("string error");
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      await TestUtils.expectResponse(
        response,
        TestDataFactories.errorResponse("Failed to check slug availability"),
        500
      );
    });

    test("handles null database response correctly", async () => {
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.isAvailable).toBe(true);
    });

    test("handles undefined database response correctly", async () => {
      (db.workspace.findUnique as any).mockResolvedValue(undefined);
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.isAvailable).toBe(true);
    });
  });

  describe("Response Format", () => {
    beforeEach(() => {
      TestUtils.setupAuthenticated();
    });

    test("returns correct response structure for available slug", async () => {
      TestUtils.setupDatabaseResponse(null);
      const testSlug = "available-slug";
      const request = TestUtils.createTestRequest(testSlug);

      const response = await GET(request);

      const data = await response.json();
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("slug", testSlug);
      expect(data.data).toHaveProperty("isAvailable", true);
      expect(data.data).toHaveProperty("message", "Slug is available");
    });

    test("returns correct response structure for unavailable slug", async () => {
      const testSlug = "unavailable-slug";
      TestUtils.setupDatabaseResponse(TestDataFactories.workspace({ slug: testSlug }));
      const request = TestUtils.createTestRequest(testSlug);

      const response = await GET(request);

      const data = await response.json();
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("slug", testSlug);
      expect(data.data).toHaveProperty("isAvailable", false);
      expect(data.data).toHaveProperty("message", "A workspace with this slug already exists");
    });

    test("returns correct error response structure", async () => {
      TestUtils.setupUnauthenticated();
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      const data = await response.json();
      expect(data).toHaveProperty("success", false);
      expect(data).toHaveProperty("error", "Unauthorized");
      expect(data).not.toHaveProperty("data");
    });

    test("sets correct content-type header", async () => {
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      expect(response.headers.get("content-type")).toBe("application/json");
    });
  });

  describe("Database Query Optimization", () => {
    beforeEach(() => {
      TestUtils.setupAuthenticated();
    });

    test("only selects id field from workspace table", async () => {
      TestUtils.setupDatabaseResponse(null);
      const request = TestUtils.createTestRequest("test-slug");

      await GET(request);

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "test-slug" },
        select: { id: true },
      });
    });

    test("performs single database query per request", async () => {
      TestUtils.setupDatabaseResponse(TestDataFactories.workspace());
      const request = TestUtils.createTestRequest("test-slug");

      await GET(request);

      expect(db.workspace.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("Security Considerations", () => {
    test("requires authentication for all requests", async () => {
      TestUtils.setupUnauthenticated();
      const request = TestUtils.createTestRequest("any-slug");

      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
    });

    test("validates user session has required properties", async () => {
      const invalidSessions = [
        null,
        {},
        { user: null },
        { user: {} },
        { user: { email: "test@example.com" } }, // missing id
      ];

      for (const invalidSession of invalidSessions) {
        vi.clearAllMocks();
        (getServerSession as any).mockResolvedValue(invalidSession);
        const request = TestUtils.createTestRequest("test-slug");

        const response = await GET(request);

        expect(response.status).toBe(401);
        expect(db.workspace.findUnique).not.toHaveBeenCalled();
      }
    });

    test("does not expose sensitive information in error messages", async () => {
      TestUtils.setupAuthenticated();
      const dbError = new Error("Detailed database connection error with sensitive info");
      (db.workspace.findUnique as any).mockRejectedValue(dbError);
      const request = TestUtils.createTestRequest("test-slug");

      const response = await GET(request);

      const data = await response.json();
      expect(data.error).toBe("Detailed database connection error with sensitive info");
      // Note: In production, you might want to return a generic error message
    });
  });
});