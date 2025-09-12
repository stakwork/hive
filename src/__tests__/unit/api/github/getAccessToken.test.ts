import { describe, test, expect, vi, beforeEach } from "vitest";
import { config } from "@/lib/env";

// Mock the config module
vi.mock("@/lib/env", () => ({
  config: {
    GITHUB_APP_CLIENT_ID: "test-client-id",
    GITHUB_APP_CLIENT_SECRET: "test-client-secret"
  }
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import the function under test from the actual route file
import { getAccessToken } from "@/app/api/github/app/callback/route";

describe("getAccessToken - OAuth Token Exchange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Successful token exchange", () => {
    test("should successfully exchange code for access token", async () => {
      const mockTokenData = {
        access_token: "gha_test_access_token_12345",
        refresh_token: "ghr_test_refresh_token_67890",
        token_type: "bearer",
        scope: "user:email,read:user"
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenData),
        status: 200
      });

      const result = await getAccessToken("test-code", "test-state");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: config.GITHUB_APP_CLIENT_ID,
            client_secret: config.GITHUB_APP_CLIENT_SECRET,
            code: "test-code",
            state: "test-state",
          }),
        }
      );

      expect(result).toEqual({
        userAccessToken: "gha_test_access_token_12345",
        userRefreshToken: "ghr_test_refresh_token_67890"
      });
    });

    test("should handle response without refresh token", async () => {
      const mockTokenData = {
        access_token: "gha_test_access_token_12345",
        token_type: "bearer",
        scope: "user:email,read:user"
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenData),
        status: 200
      });

      const result = await getAccessToken("test-code", "test-state");

      expect(result).toEqual({
        userAccessToken: "gha_test_access_token_12345",
        userRefreshToken: undefined
      });
    });
  });

  describe("HTTP error scenarios", () => {
    test("should throw error for 400 Bad Request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request"
      });

      await expect(getAccessToken("invalid-code", "test-state"))
        .rejects.toThrow("HTTP error! status: 400");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should throw error for 401 Unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      });

      await expect(getAccessToken("test-code", "invalid-state"))
        .rejects.toThrow("HTTP error! status: 401");
    });

    test("should throw error for 403 Forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden"
      });

      await expect(getAccessToken("test-code", "test-state"))
        .rejects.toThrow("HTTP error! status: 403");
    });

    test("should throw error for 500 Internal Server Error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      });

      await expect(getAccessToken("test-code", "test-state"))
        .rejects.toThrow("HTTP error! status: 500");
    });
  });

  describe("Network and response parsing errors", () => {
    test("should handle network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(getAccessToken("test-code", "test-state"))
        .rejects.toThrow("Network error");
    });

    test("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
        status: 200
      });

      await expect(getAccessToken("test-code", "test-state"))
        .rejects.toThrow("Invalid JSON");
    });

    test("should handle empty response body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
        status: 200
      });

      const result = await getAccessToken("test-code", "test-state");

      expect(result).toEqual({
        userAccessToken: undefined,
        userRefreshToken: undefined
      });
    });
  });

  describe("Security and sensitive data handling", () => {
    test("should not expose client secret in error messages", async () => {
      // Spy on console methods to ensure sensitive data isn't logged
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValueOnce(new Error("Request failed"));

      try {
        await getAccessToken("test-code", "test-state");
      } catch (error) {
        // Verify error doesn't contain sensitive data
        expect(error.message).not.toContain("test-client-secret");
        expect(error.message).not.toContain(config.GITHUB_APP_CLIENT_SECRET);
      }

      // Verify nothing sensitive was logged
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("test-client-secret")
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("test-client-secret")
      );

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    test("should handle missing environment variables gracefully", async () => {
      // Temporarily override config to simulate missing environment variables
      vi.mocked(config).GITHUB_APP_CLIENT_ID = undefined as any;
      vi.mocked(config).GITHUB_APP_CLIENT_SECRET = undefined as any;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      });

      await expect(getAccessToken("test-code", "test-state"))
        .rejects.toThrow("HTTP error! status: 401");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          body: JSON.stringify({
            client_id: undefined,
            client_secret: undefined,
            code: "test-code",
            state: "test-state",
          }),
        })
      );
    });
  });

  describe("Input validation edge cases", () => {
    test("should handle empty code parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request"
      });

      await expect(getAccessToken("", "test-state"))
        .rejects.toThrow("HTTP error! status: 400");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          body: JSON.stringify({
            client_id: config.GITHUB_APP_CLIENT_ID,
            client_secret: config.GITHUB_APP_CLIENT_SECRET,
            code: "",
            state: "test-state",
          }),
        })
      );
    });

    test("should handle empty state parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request"
      });

      await expect(getAccessToken("test-code", ""))
        .rejects.toThrow("HTTP error! status: 400");
    });

    test("should handle null/undefined parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request"
      });

      await expect(getAccessToken(null as any, undefined as any))
        .rejects.toThrow("HTTP error! status: 400");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          body: JSON.stringify({
            client_id: config.GITHUB_APP_CLIENT_ID,
            client_secret: config.GITHUB_APP_CLIENT_SECRET,
            code: null,
            state: undefined,
          }),
        })
      );
    });
  });

  describe("GitHub API specific error responses", () => {
    test("should handle GitHub error response format", async () => {
      const githubErrorResponse = {
        error: "bad_verification_code",
        error_description: "The code passed is incorrect or expired.",
        error_uri: "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code"
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve(githubErrorResponse)
      });

      await expect(getAccessToken("expired-code", "test-state"))
        .rejects.toThrow("HTTP error! status: 400");
    });

    test("should handle rate limiting response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Map([
          ["X-RateLimit-Limit", "5000"],
          ["X-RateLimit-Remaining", "0"],
          ["X-RateLimit-Reset", "1640995200"]
        ])
      });

      await expect(getAccessToken("test-code", "test-state"))
        .rejects.toThrow("HTTP error! status: 429");
    });
  });
});