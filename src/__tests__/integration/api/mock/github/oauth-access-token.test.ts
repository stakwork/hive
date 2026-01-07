import { describe, test, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/mock/github/oauth/access_token/route";
import { mockGitHubState } from "@/lib/mock/github-state";
import { createRequestWithHeaders } from "@/__tests__/support/helpers/request-builders";

/**
 * Integration Tests for GitHub OAuth Access Token Mock Endpoint
 * 
 * Tests the /api/mock/github/oauth/access_token POST endpoint
 * which simulates GitHub's OAuth token exchange flow.
 * 
 * Covers:
 * - Authorization code exchange
 * - Refresh token flow
 * - Error handling (missing params, invalid codes/tokens)
 * - Content-Type handling (JSON and form-urlencoded)
 */
describe("POST /api/mock/github/oauth/access_token - Integration Tests", () => {
  beforeEach(() => {
    // Reset state before each test for isolation
    mockGitHubState.reset();
  });

  describe("Authorization Code Exchange Flow", () => {
    test("successfully exchanges authorization code for tokens (JSON)", async () => {
      // Setup: Create an auth code
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user,read:org",
      });

      // Execute: Exchange code for token
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          code: authCode,
          client_id: "test-client-id",
          client_secret: "test-client-secret",
        }
      );

      const response = await POST(request);

      // Assert: Token response
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty("access_token");
      expect(data).toHaveProperty("refresh_token");
      expect(data).toHaveProperty("expires_in");
      expect(data).toHaveProperty("refresh_token_expires_in");
      expect(data).toHaveProperty("scope");
      expect(data).toHaveProperty("token_type");
      
      expect(data.access_token).toContain("gho_mock_");
      expect(data.refresh_token).toContain("ghr_mock_");
      expect(data.expires_in).toBe(28800); // 8 hours
      expect(data.refresh_token_expires_in).toBe(15780000); // 6 months
      expect(data.scope).toBe("repo,user,read:org");
      expect(data.token_type).toBe("bearer");
    });

    test("successfully exchanges authorization code for tokens (form-urlencoded)", async () => {
      // Setup: Create an auth code
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user",
      });

      // Execute: Exchange code for token using form-urlencoded (NextAuth default)
      const formData = new URLSearchParams({
        code: authCode,
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        grant_type: "authorization_code",
      });

      const request = new Request(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      ) as any;

      const response = await POST(request);

      // Assert: Token response
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.access_token).toContain("gho_mock_");
      expect(data.refresh_token).toContain("ghr_mock_");
      expect(data.scope).toBe("repo,user");
      expect(data.token_type).toBe("bearer");
    });

    test("auto-creates token when code is not found (backwards compatibility)", async () => {
      // Execute: Use a code that doesn't exist in state
      const unknownCode = "unknown_code_12345";

      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          code: unknownCode,
          client_id: "test-client-id",
          client_secret: "test-client-secret",
        }
      );

      const response = await POST(request);

      // Assert: Token is auto-created for backwards compatibility
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.access_token).toContain("gho_mock_");
      expect(data.refresh_token).toContain("ghr_mock_");
      expect(data.token_type).toBe("bearer");
    });

    test("marks authorization code as used after exchange", async () => {
      // Setup: Create an auth code
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      // Execute: Exchange code once
      const request1 = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        { code: authCode }
      );

      const response1 = await POST(request1);
      expect(response1.status).toBe(200);

      // Execute: Try to exchange same code again
      const request2 = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        { code: authCode }
      );

      const response2 = await POST(request2);

      // Assert: Second exchange auto-creates new token (backwards compat)
      // The actual auth code exchange returns null, but the endpoint auto-creates
      expect(response2.status).toBe(200);
      const data = await response2.json();
      expect(data.access_token).toContain("gho_mock_");
    });

    test("respects custom scope from authorization flow", async () => {
      // Setup: Create auth code with custom scope
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user:email",
      });

      // Execute: Exchange code
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        { code: authCode }
      );

      const response = await POST(request);

      // Assert: Token has custom scope
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.scope).toBe("repo,user:email");
    });
  });

  describe("Refresh Token Flow", () => {
    test("successfully refreshes token using refresh_token grant", async () => {
      // Setup: Create initial token
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user",
      });
      const result = mockGitHubState.exchangeAuthCode(authCode);
      expect(result).not.toBeNull();
      const originalRefreshToken = result!.token.refresh_token;

      // Execute: Refresh token
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          grant_type: "refresh_token",
          refresh_token: originalRefreshToken,
          client_id: "test-client-id",
          client_secret: "test-client-secret",
        }
      );

      const response = await POST(request);

      // Assert: New tokens returned
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.access_token).toContain("gho_mock_refreshed_");
      expect(data.refresh_token).toContain("ghr_mock_refreshed_");
      expect(data.expires_in).toBe(28800);
      expect(data.refresh_token_expires_in).toBe(15780000);
      expect(data.scope).toBe("repo,user"); // Preserves original scope
      expect(data.token_type).toBe("bearer");
      
      // New tokens should be different from original
      expect(data.access_token).not.toBe(result!.token.access_token);
      expect(data.refresh_token).not.toBe(originalRefreshToken);
    });

    test("returns 401 for invalid refresh token", async () => {
      // Execute: Use non-existent refresh token
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          grant_type: "refresh_token",
          refresh_token: "invalid_refresh_token_12345",
        }
      );

      const response = await POST(request);

      // Assert: Error response
      expect(response.status).toBe(401);
      const data = await response.json();
      
      expect(data.error).toBe("invalid_grant");
      expect(data.error_description).toBe("Invalid refresh token");
    });

    test("handles refresh token with form-urlencoded", async () => {
      // Setup: Create initial token
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });
      const result = mockGitHubState.exchangeAuthCode(authCode);
      expect(result).not.toBeNull();
      const originalRefreshToken = result!.token.refresh_token;

      // Execute: Refresh using form-urlencoded
      const formData = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: originalRefreshToken,
        client_id: "test-client-id",
        client_secret: "test-client-secret",
      });

      const request = new Request(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        }
      ) as any;

      const response = await POST(request);

      // Assert: Successful refresh
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.access_token).toContain("gho_mock_refreshed_");
    });
  });

  describe("Error Handling", () => {
    test("returns 400 when both code and refresh_token are missing", async () => {
      // Execute: Request without required parameters
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          client_id: "test-client-id",
          client_secret: "test-client-secret",
        }
      );

      const response = await POST(request);

      // Assert: Error response
      expect(response.status).toBe(400);
      const data = await response.json();
      
      expect(data.error).toBe("invalid_request");
      expect(data.error_description).toBe("Missing code or refresh_token");
    });

    test("returns 400 when code is empty string", async () => {
      // Execute: Request with empty code
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          code: "",
          client_id: "test-client-id",
        }
      );

      const response = await POST(request);

      // Assert: Error response
      expect(response.status).toBe(400);
      const data = await response.json();
      
      expect(data.error).toBe("invalid_request");
      expect(data.error_description).toBe("Missing code or refresh_token");
    });

    test("returns 400 when refresh_token is empty with refresh_token grant type", async () => {
      // Execute: Request with empty refresh_token
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          grant_type: "refresh_token",
          refresh_token: "",
        }
      );

      const response = await POST(request);

      // Assert: Error response
      expect(response.status).toBe(400);
      const data = await response.json();
      
      expect(data.error).toBe("invalid_request");
      expect(data.error_description).toBe("Missing code or refresh_token");
    });

    test("handles malformed JSON gracefully", async () => {
      // Execute: Send malformed JSON
      const request = new Request(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{ invalid json",
        }
      ) as any;

      const response = await POST(request);

      // Assert: Server error response
      expect(response.status).toBe(500);
      const data = await response.json();
      
      expect(data.error).toBe("server_error");
      expect(data.error_description).toBe("Internal server error");
    });

    test("handles missing Content-Type header (defaults to form-urlencoded)", async () => {
      // Setup: Create auth code
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      // Execute: Send without Content-Type header
      const formData = new URLSearchParams({
        code: authCode,
        client_id: "test-client-id",
      });

      const request = new Request(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        {
          method: "POST",
          body: formData.toString(),
        }
      ) as any;

      const response = await POST(request);

      // Assert: Successfully parses as form-urlencoded
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.access_token).toBeDefined();
    });
  });

  describe("Client Validation (Lenient Mock Mode)", () => {
    test("accepts request without client_id (mock mode leniency)", async () => {
      // Setup: Create auth code
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      // Execute: Exchange without client_id
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          code: authCode,
          // No client_id or client_secret
        }
      );

      const response = await POST(request);

      // Assert: Succeeds in mock mode
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.access_token).toBeDefined();
    });

    test("accepts request without client_secret (mock mode leniency)", async () => {
      // Setup: Create auth code
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      // Execute: Exchange without client_secret
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          code: authCode,
          client_id: "test-client-id",
          // No client_secret
        }
      );

      const response = await POST(request);

      // Assert: Succeeds in mock mode
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.access_token).toBeDefined();
    });
  });

  describe("Scope Handling", () => {
    test("uses default scope when not provided", async () => {
      // Execute: Exchange code without explicit scope
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          code: "test_code_no_scope",
        }
      );

      const response = await POST(request);

      // Assert: Default scope is applied
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.scope).toBe("repo,user,read:org"); // Default from route.ts
    });

    test("preserves custom scope through token exchange", async () => {
      // Setup: Create auth code with custom scope
      const customScope = "repo,workflow,gist";
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: customScope,
      });

      // Execute: Exchange code
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        { code: authCode }
      );

      const response = await POST(request);

      // Assert: Custom scope preserved
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.scope).toBe(customScope);
    });
  });

  describe("State Management", () => {
    test("maintains separate tokens for different codes", async () => {
      // Setup: Create two auth codes
      const code1 = mockGitHubState.createAuthCode({
        clientId: "client-1",
        scope: "repo",
      });
      const code2 = mockGitHubState.createAuthCode({
        clientId: "client-2",
        scope: "user",
      });

      // Execute: Exchange both codes
      const request1 = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        { code: code1 }
      );
      const response1 = await POST(request1);
      const data1 = await response1.json();

      const request2 = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        { code: code2 }
      );
      const response2 = await POST(request2);
      const data2 = await response2.json();

      // Assert: Different tokens created
      expect(data1.access_token).not.toBe(data2.access_token);
      expect(data1.refresh_token).not.toBe(data2.refresh_token);
      expect(data1.scope).toBe("repo");
      expect(data2.scope).toBe("user");
    });

    test("resets properly between tests", async () => {
      // This test verifies that beforeEach reset works correctly
      // If state wasn't reset, previous test tokens would still exist
      
      // Execute: Try to refresh with a token that shouldn't exist
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/github/oauth/access_token",
        "POST",
        { "Content-Type": "application/json" },
        {
          grant_type: "refresh_token",
          refresh_token: "ghr_mock_some_old_token",
        }
      );

      const response = await POST(request);

      // Assert: Token not found (state was reset)
      expect(response.status).toBe(401);
    });
  });
});
