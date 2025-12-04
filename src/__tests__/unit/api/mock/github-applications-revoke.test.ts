import { describe, it, expect, beforeEach, vi } from "vitest";
import { DELETE } from "@/app/api/mock/github/applications/revoke/route";
import { NextRequest } from "next/server";
import { MockGitHubState } from "@/lib/mock/github-state";
import { config } from "@/config/env";

describe("Mock GitHub Applications Revoke Endpoint", () => {
  let mockState: ReturnType<typeof MockGitHubState.getInstance>;

  beforeEach(() => {
    mockState = MockGitHubState.getInstance();
    mockState.reset();
  });

  describe("when USE_MOCKS is enabled", () => {
    beforeEach(() => {
      vi.spyOn(config, "USE_MOCKS", "get").mockReturnValue(true);
    });

    it("successfully revokes a valid token", async () => {
      // Setup: Create a mock token
      const testToken = "gho_test_token_123";
      mockState.createToken("test_code", "repo,user");
      const token = mockState.getTokenByCode("test_code");
      expect(token).toBeDefined();
      
      // Mock the token to have our test access token
      if (token) {
        token.access_token = testToken;
      }

      // Create request with proper auth
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: testToken }),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(204);
      expect(mockState.isTokenRevoked(testToken)).toBe(true);
    });

    it("returns 404 for non-existent token", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: "non_existent_token" }),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.message).toBe("Not Found");
    });

    it("returns 404 for already-revoked token", async () => {
      // Setup: Create and revoke a token
      const testToken = "gho_test_token_456";
      mockState.createToken("test_code_2", "repo");
      const token = mockState.getTokenByCode("test_code_2");
      if (token) {
        token.access_token = testToken;
      }
      mockState.revokeToken(testToken);

      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: testToken }),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(404);
    });

    it("returns 401 for missing authentication", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: "some_token" }),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe("Requires authentication");
    });

    it("returns 401 for invalid authentication format", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: "Bearer invalid_format",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: "some_token" }),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe("Requires authentication");
    });

    it("returns 422 for missing access_token in body", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.message).toBe("access_token is required");
    });

    it("validates token cannot be used after revocation", async () => {
      // Setup: Create a token
      const testToken = "gho_test_token_789";
      const testCode = "test_code_3";
      mockState.createToken(testCode, "repo,user");
      const token = mockState.getTokenByCode(testCode);
      if (token) {
        token.access_token = testToken;
      }

      // Verify token is available before revocation
      expect(mockState.getTokenByCode(testCode)).toBeDefined();

      // Revoke the token
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: testToken }),
        }
      );

      await DELETE(request);

      // Verify token is no longer available after revocation
      expect(mockState.getTokenByCode(testCode)).toBeUndefined();
      expect(mockState.isTokenRevoked(testToken)).toBe(true);
    });
  });

  describe("when USE_MOCKS is disabled", () => {
    beforeEach(() => {
      vi.spyOn(config, "USE_MOCKS", "get").mockReturnValue(false);
    });

    it("returns 404 when mock mode is disabled", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/applications/revoke",
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${Buffer.from("client_id:client_secret").toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: "some_token" }),
        }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.message).toBe("Not found");
    });
  });
});
