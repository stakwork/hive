import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { getMiddlewareContext, requireAuth, patternToRegex } from "@/lib/middleware/utils";
import type { AuthStatus } from "@/types/middleware";

function createRequestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    headers: new Headers(headers),
  });
}

describe("getMiddlewareContext", () => {
  describe("Valid Authentication Context", () => {
    it("extracts complete authenticated context with all user fields", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-123",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
        [MIDDLEWARE_HEADERS.USER_ID]: "user-123",
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
      });

      const context = getMiddlewareContext(request);

      expect(context.requestId).toBe("req-123");
      expect(context.authStatus).toBe("authenticated");
      expect(context.user).toEqual({
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      });
    });

    it("extracts public route context without user data", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-456",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "public",
      });

      const context = getMiddlewareContext(request);

      expect(context.requestId).toBe("req-456");
      expect(context.authStatus).toBe("public");
      expect(context.user).toBeUndefined();
    });

    it("extracts webhook route context without user data", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-789",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "webhook",
      });

      const context = getMiddlewareContext(request);

      expect(context.requestId).toBe("req-789");
      expect(context.authStatus).toBe("webhook");
      expect(context.user).toBeUndefined();
    });
  });

  describe("Invalid Authentication Status", () => {
    it("defaults to error status for invalid auth status header", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-invalid",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "invalid-status",
      });

      const context = getMiddlewareContext(request);

      expect(context.authStatus).toBe("error");
      expect(context.user).toBeUndefined();
    });

    it("defaults to error status when auth status header is missing", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-missing",
      });

      const context = getMiddlewareContext(request);

      expect(context.authStatus).toBe("error");
      expect(context.user).toBeUndefined();
    });

    it("handles empty auth status header", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-empty",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "",
      });

      const context = getMiddlewareContext(request);

      expect(context.authStatus).toBe("error");
    });
  });

  describe("Partial User Data", () => {
    it("does not create user object when user ID is missing", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-no-id",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
      });

      const context = getMiddlewareContext(request);

      expect(context.authStatus).toBe("authenticated");
      expect(context.user).toBeUndefined();
    });

    it("does not create user object when user email is missing", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-no-email",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
        [MIDDLEWARE_HEADERS.USER_ID]: "user-123",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
      });

      const context = getMiddlewareContext(request);

      expect(context.authStatus).toBe("authenticated");
      expect(context.user).toBeUndefined();
    });

    it("does not create user object when user name is missing", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-no-name",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
        [MIDDLEWARE_HEADERS.USER_ID]: "user-123",
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
      });

      const context = getMiddlewareContext(request);

      expect(context.authStatus).toBe("authenticated");
      expect(context.user).toBeUndefined();
    });
  });

  describe("Missing Request ID", () => {
    it("defaults to empty string when request ID is missing", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "public",
      });

      const context = getMiddlewareContext(request);

      expect(context.requestId).toBe("");
      expect(context.authStatus).toBe("public");
    });
  });

  describe("Special Characters in User Data", () => {
    it("handles special characters in user name", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-special",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
        [MIDDLEWARE_HEADERS.USER_ID]: "user-123",
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User-O'Neill (Admin)",
      });

      const context = getMiddlewareContext(request);

      expect(context.user?.name).toBe("Test User-O'Neill (Admin)");
    });

    it("handles special characters in email", () => {
      const request = createRequestWithHeaders({
        [MIDDLEWARE_HEADERS.REQUEST_ID]: "req-special-email",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
        [MIDDLEWARE_HEADERS.USER_ID]: "user-123",
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test+tag@sub.example.com",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
      });

      const context = getMiddlewareContext(request);

      expect(context.user?.email).toBe("test+tag@sub.example.com");
    });
  });
});

describe("requireAuth", () => {
  it("returns user object when context is authenticated", () => {
    const context = {
      requestId: "req-123",
      authStatus: "authenticated" as AuthStatus,
      user: {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      },
    };

    const result = requireAuth(context);

    expect(result).toEqual({
      id: "user-123",
      email: "test@example.com",
      name: "Test User",
    });
  });

  it("returns 401 response when context is not authenticated", () => {
    const context = {
      requestId: "req-456",
      authStatus: "public" as AuthStatus,
    };

    const result = requireAuth(context);

    expect(result).toHaveProperty("status", 401);
  });

  it("returns 401 response when user is missing despite authenticated status", () => {
    const context = {
      requestId: "req-789",
      authStatus: "authenticated" as AuthStatus,
      // Missing user object
    };

    const result = requireAuth(context);

    expect(result).toHaveProperty("status", 401);
  });

  it("returns 401 response for webhook context", () => {
    const context = {
      requestId: "req-webhook",
      authStatus: "webhook" as AuthStatus,
    };

    const result = requireAuth(context);

    expect(result).toHaveProperty("status", 401);
  });

  it("returns 401 response for error context", () => {
    const context = {
      requestId: "req-error",
      authStatus: "error" as AuthStatus,
    };

    const result = requireAuth(context);

    expect(result).toHaveProperty("status", 401);
  });

  it("returns NextResponse with correct error format", async () => {
    const context = {
      requestId: "req-format",
      authStatus: "public" as AuthStatus,
    };

    const result = requireAuth(context);

    if ("status" in result) {
      const json = await result.json();
      expect(json).toHaveProperty("error", "Unauthorized");
      expect(json).toHaveProperty("kind");
    }
  });
});

describe("patternToRegex", () => {
  describe("Single Wildcard Patterns", () => {
    it("converts single wildcard to regex", () => {
      const regex = patternToRegex("/api/tasks/*/title");

      expect(regex.test("/api/tasks/123/title")).toBe(true);
      expect(regex.test("/api/tasks/abc-def/title")).toBe(true);
      expect(regex.test("/api/tasks/123/status")).toBe(false);
      expect(regex.test("/api/tasks/123/nested/title")).toBe(false);
    });

    it("matches wildcard with alphanumeric characters", () => {
      const regex = patternToRegex("/api/users/*/profile");

      expect(regex.test("/api/users/user123/profile")).toBe(true);
      expect(regex.test("/api/users/abc-xyz/profile")).toBe(true);
      expect(regex.test("/api/users/Test_User/profile")).toBe(true);
    });

    it("does not match empty wildcard segment", () => {
      const regex = patternToRegex("/api/tasks/*/title");

      expect(regex.test("/api/tasks//title")).toBe(false);
    });

    it("does not match wildcard with forward slash", () => {
      const regex = patternToRegex("/api/tasks/*/title");

      expect(regex.test("/api/tasks/123/nested/title")).toBe(false);
    });
  });

  describe("Multiple Wildcard Patterns", () => {
    it("converts multiple wildcards to regex", () => {
      const regex = patternToRegex("/api/*/resources/*/download");

      expect(regex.test("/api/workspace1/resources/file123/download")).toBe(true);
      expect(regex.test("/api/workspace2/resources/doc456/download")).toBe(true);
      expect(regex.test("/api/workspace1/resources/file123/view")).toBe(false);
      expect(regex.test("/api/workspace1/files/file123/download")).toBe(false);
    });

    it("handles adjacent wildcards correctly", () => {
      const regex = patternToRegex("/api/*/*/data");

      expect(regex.test("/api/v1/users/data")).toBe(true);
      expect(regex.test("/api/v2/tasks/data")).toBe(true);
      expect(regex.test("/api/v1/data")).toBe(false);
      expect(regex.test("/api/v1/users/extra/data")).toBe(false);
    });
  });

  describe("Edge Wildcard Patterns", () => {
    it("handles wildcard at the start", () => {
      const regex = patternToRegex("/*/api/data");

      expect(regex.test("/v1/api/data")).toBe(true);
      expect(regex.test("/v2/api/data")).toBe(true);
      expect(regex.test("//api/data")).toBe(false);
    });

    it("handles wildcard at the end", () => {
      const regex = patternToRegex("/api/data/*");

      expect(regex.test("/api/data/123")).toBe(true);
      expect(regex.test("/api/data/abc")).toBe(true);
      expect(regex.test("/api/data/123/nested")).toBe(false);
    });

    it("handles pattern with only wildcard", () => {
      const regex = patternToRegex("/*");

      expect(regex.test("/api")).toBe(true);
      expect(regex.test("/users")).toBe(true);
      expect(regex.test("/api/nested")).toBe(false);
    });
  });

  describe("Special Characters in Patterns", () => {
    it("escapes regex special characters", () => {
      const regex = patternToRegex("/api/data.*/export");

      expect(regex.test("/api/data.*/export")).toBe(true);
      expect(regex.test("/api/dataXX/export")).toBe(false);
    });

    it("escapes parentheses", () => {
      const regex = patternToRegex("/api/(v1)/data");

      expect(regex.test("/api/(v1)/data")).toBe(true);
      expect(regex.test("/api/v1/data")).toBe(false);
    });

    it("escapes square brackets", () => {
      const regex = patternToRegex("/api/[id]/data");

      expect(regex.test("/api/[id]/data")).toBe(true);
      expect(regex.test("/api/123/data")).toBe(false);
    });

    it("escapes plus signs", () => {
      const regex = patternToRegex("/api/test+data");

      expect(regex.test("/api/test+data")).toBe(true);
      expect(regex.test("/api/testdata")).toBe(false);
    });
  });

  describe("Pattern Anchoring", () => {
    it("anchors pattern to start and end", () => {
      const regex = patternToRegex("/api/tasks");

      expect(regex.test("/api/tasks")).toBe(true);
      expect(regex.test("prefix/api/tasks")).toBe(false);
      expect(regex.test("/api/tasks/suffix")).toBe(false);
    });

    it("requires exact match with wildcards", () => {
      const regex = patternToRegex("/api/*/data");

      expect(regex.test("/api/123/data")).toBe(true);
      expect(regex.test("extra/api/123/data")).toBe(false);
      expect(regex.test("/api/123/data/extra")).toBe(false);
    });
  });

  describe("Complex Real-World Patterns", () => {
    it("matches GitHub webhook URLs", () => {
      const regex = patternToRegex("/api/github/*/webhook");

      expect(regex.test("/api/github/repo123/webhook")).toBe(true);
      expect(regex.test("/api/github/org-name/webhook")).toBe(true);
    });

    it("matches dynamic API versioning", () => {
      const regex = patternToRegex("/api/*/users/*/profile");

      expect(regex.test("/api/v1/users/user123/profile")).toBe(true);
      expect(regex.test("/api/v2/users/admin/profile")).toBe(true);
      expect(regex.test("/api/v1/users/user123/settings")).toBe(false);
    });

    it("matches file paths with wildcards", () => {
      const regex = patternToRegex("/files/*/download/*");

      expect(regex.test("/files/document1/download/pdf")).toBe(true);
      expect(regex.test("/files/image2/download/png")).toBe(true);
      expect(regex.test("/files/document1/view/pdf")).toBe(false);
    });
  });
});
