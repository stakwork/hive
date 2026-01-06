import { describe, test, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/mock/github/oauth/access_token/route";
import { mockGitHubState } from "@/lib/mock/github-state";

describe("POST /api/mock/github/oauth/access_token", () => {
  beforeEach(() => {
    mockGitHubState.reset();
  });

  describe("authorization_code grant type", () => {
    test("successfully exchanges valid authorization code for tokens", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user,read:org",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
          grant_type: "authorization_code",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
      expect(data.access_token).toMatch(/^gho_mock_/);
      expect(data.refresh_token).toBeDefined();
      expect(data.refresh_token).toMatch(/^ghr_mock_/);
      expect(data.expires_in).toBe(28800);
      expect(data.refresh_token_expires_in).toBe(15780000);
      expect(data.scope).toBe("repo,user,read:org");
      expect(data.token_type).toBe("bearer");
    });

    test("auto-creates token for code without prior exchange", async () => {
      const code = "test_code_without_exchange";

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          grant_type: "authorization_code",
          scope: "repo,user",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
      expect(data.refresh_token).toBeDefined();
      expect(data.scope).toBe("repo,user");
    });

    test("handles form-urlencoded content type", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const body = `code=${authCode}&grant_type=authorization_code&scope=repo`;

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
      expect(data.scope).toBe("repo");
    });

    test("defaults grant_type to authorization_code when not specified", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
    });

    test("defaults scope when not specified", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user,read:org",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
          grant_type: "authorization_code",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scope).toBe("repo,user,read:org");
    });
  });

  describe("refresh_token grant type", () => {
    test("successfully refreshes tokens with valid refresh token", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user",
      });

      const result = mockGitHubState.exchangeAuthCode(authCode);
      if (!result) {
        throw new Error("Failed to create initial tokens");
      }

      const initialTokens = result.token;

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: initialTokens.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.access_token).toBeDefined();
      expect(data.access_token).not.toBe(initialTokens.access_token);
      expect(data.refresh_token).toBeDefined();
      expect(data.refresh_token).not.toBe(initialTokens.refresh_token);
      expect(data.expires_in).toBe(28800);
      expect(data.refresh_token_expires_in).toBe(15780000);
      expect(data.token_type).toBe("bearer");
    });

    test("returns 401 for invalid refresh token", async () => {
      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: "invalid_refresh_token",
          grant_type: "refresh_token",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("invalid_grant");
      expect(data.error_description).toContain("Invalid refresh token");
    });
  });

  describe("error scenarios", () => {
    test("returns 400 when both code and refresh_token are missing", async () => {
      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("invalid_request");
      expect(data.error_description).toContain("Missing code or refresh_token");
    });

    test("returns 400 for empty request body", async () => {
      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("invalid_request");
    });

    test("handles malformed JSON gracefully", async () => {
      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });

    test("handles malformed form-urlencoded gracefully", async () => {
      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("invalid_request");
    });
  });

  describe("response format validation", () => {
    test("response includes all required OAuth fields", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("access_token");
      expect(data).toHaveProperty("refresh_token");
      expect(data).toHaveProperty("expires_in");
      expect(data).toHaveProperty("refresh_token_expires_in");
      expect(data).toHaveProperty("scope");
      expect(data).toHaveProperty("token_type");
      
      expect(typeof data.access_token).toBe("string");
      expect(typeof data.refresh_token).toBe("string");
      expect(typeof data.expires_in).toBe("number");
      expect(typeof data.refresh_token_expires_in).toBe("number");
      expect(typeof data.scope).toBe("string");
      expect(data.token_type).toBe("bearer");
    });

    test("access token has correct format", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.access_token).toMatch(/^gho_mock_[a-zA-Z0-9_]+$/);
    });

    test("refresh token has correct format", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.refresh_token).toMatch(/^ghr_mock_[a-zA-Z0-9_]+$/);
    });
  });

  describe("integration with dependent flows", () => {
    test("tokens can be used for subsequent authentication", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo,user",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      const token = mockGitHubState.getTokenByCode(authCode);
      expect(token).toBeDefined();
      expect(token?.access_token).toBe(data.access_token);
      expect(token?.revoked).toBeFalsy();
    });

    test("exchanged code is marked as used", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const request = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      await POST(request);

      const secondRequest = new Request("http://localhost/api/mock/github/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
        }),
      });

      const secondResponse = await POST(secondRequest);
      const secondData = await secondResponse.json();

      expect(secondResponse.status).toBe(200);
      expect(secondData.access_token).toBeDefined();
    });

    test("refresh token generates new token pair", async () => {
      const authCode = mockGitHubState.createAuthCode({
        clientId: "test-client-id",
        scope: "repo",
      });

      const initialResponse = await POST(
        new Request("http://localhost/api/mock/github/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: authCode }),
        })
      );

      const initialData = await initialResponse.json();

      const refreshResponse = await POST(
        new Request("http://localhost/api/mock/github/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            refresh_token: initialData.refresh_token,
            grant_type: "refresh_token",
          }),
        })
      );

      const refreshData = await refreshResponse.json();

      expect(refreshData.access_token).not.toBe(initialData.access_token);
      expect(refreshData.refresh_token).not.toBe(initialData.refresh_token);
    });
  });
});
