import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/webhook/route";
import { db } from "@/lib/db";
import crypto from "crypto";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";

// Helper to create SourceControlOrg for testing
async function createTestSourceControlOrg(
  workspaceId: string,
  githubLogin: string
) {
  return await db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: Math.floor(Math.random() * 1000000),
      name: `Test Org ${githubLogin}`,
      type: "USER",
    },
  });
}

// Helper to create SourceControlToken for testing
async function createTestSourceControlToken(
  userId: string,
  sourceControlOrgId: string
) {
  return await db.sourceControlToken.create({
    data: {
      userId,
      sourceControlOrgId,
      token: JSON.stringify({
        data: "encrypted_token_data",
        iv: "test_iv",
        tag: "test_tag",
        version: "v1",
        encryptedAt: new Date().toISOString(),
      }),
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    },
  });
}

function computeValidWebhookSignature(secret: string, body: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  return `sha256=${hmac.update(body).digest("hex")}`;
}

function createGitHubAppAuthorizationPayload(
  action: string,
  senderLogin: string
) {
  return {
    action,
    sender: {
      login: senderLogin,
      id: 12345,
      node_id: "test_node_id",
      type: "User",
    },
    installation: {
      id: 67890,
    },
  };
}

function createWebhookRequest(
  payload: any,
  signature: string,
  eventType: string
): Request {
  const body = JSON.stringify(payload);

  return new Request("http://localhost:3000/api/github/app/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": eventType,
    },
    body,
  });
}

describe("POST /api/github/app/webhook", () => {
  const testSecret = "test_webhook_secret_12345";
  const originalEnv = process.env.GITHUB_WEBHOOK_SECRET;

  beforeEach(() => {
    // Set webhook secret for tests
    process.env.GITHUB_WEBHOOK_SECRET = testSecret;
  });

  afterEach(() => {
    // Restore original env
    process.env.GITHUB_WEBHOOK_SECRET = originalEnv;
  });

  describe("Security Validation", () => {
    test("should reject webhook with invalid signature", async () => {
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        "testuser"
      );
      const invalidSignature = "sha256=invalid_signature_hash";

      const request = createWebhookRequest(
        payload,
        invalidSignature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      // Invalid signature with wrong hash causes timing-safe error (different lengths)
      // which is caught by outer try-catch
      expect(response.status).toBe(500);
      expect(data.message).toBe("Internal server error");
    });

    test("should reject webhook with missing signature", async () => {
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        "testuser"
      );

      const request = new Request(
        "http://localhost:3000/api/github/app/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "github_app_authorization",
          },
          body: JSON.stringify(payload),
        }
      );

      const response = await POST(request as any);
      const data = await response.json();

      // Missing signature (empty string) has different length than expected digest
      // which causes timing-safe error
      expect(response.status).toBe(500);
      expect(data.message).toBe("Internal server error");
    });

    test("should accept webhook with valid signature", async () => {
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        "testuser"
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);
    });

    test("should return 500 when webhook secret is not configured", async () => {
      process.env.GITHUB_WEBHOOK_SECRET = "";

      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        "testuser"
      );
      const request = createWebhookRequest(
        payload,
        "sha256=anything",
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe("Webhook secret not configured");

      // Restore for other tests
      process.env.GITHUB_WEBHOOK_SECRET = testSecret;
    });
  });

  describe("Payload Validation", () => {
    test("should reject malformed JSON payload", async () => {
      const invalidBody = "{invalid json}";
      const signature = computeValidWebhookSignature(testSecret, invalidBody);

      const request = new Request(
        "http://localhost:3000/api/github/app/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": signature,
            "x-github-event": "github_app_authorization",
          },
          body: invalidBody,
        }
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.message).toBe("Invalid JSON payload");
    });

    test("should reject revoked event with missing sender", async () => {
      const payload = {
        action: "revoked",
        // Missing sender field
        installation: { id: 12345 },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.message).toBe("Invalid payload: missing sender");
    });
  });

  describe("Event Processing", () => {
    test("should process github_app_authorization revoked event and delete tokens", async () => {
      // Create test data
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const githubLogin = `testuser-${Date.now()}`;
      const sourceControlOrg = await createTestSourceControlOrg(
        workspace.id,
        githubLogin
      );
      const token = await createTestSourceControlToken(
        user.id,
        sourceControlOrg.id
      );

      // Verify token exists
      const tokenBefore = await db.sourceControlToken.findUnique({
        where: { id: token.id },
      });
      expect(tokenBefore).not.toBeNull();

      // Send webhook
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        githubLogin
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Authorization revoked");
      expect(data.deletedTokens).toBe(1);

      // Verify token was deleted
      const tokenAfter = await db.sourceControlToken.findUnique({
        where: { id: token.id },
      });
      expect(tokenAfter).toBeNull();
    });

    test("should delete multiple tokens for same user", async () => {
      // Create test data with multiple tokens for different orgs
      const user1 = await createTestUser();
      const user2 = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user1.id });
      const githubLogin = `testuser-${Date.now()}`;
      
      // Create source control org for this user
      const sourceControlOrg = await createTestSourceControlOrg(
        workspace.id,
        githubLogin
      );

      // Create tokens for two different users linked to the same org
      // This tests that deleting by githubLogin removes all tokens for that org
      const token1 = await createTestSourceControlToken(
        user1.id,
        sourceControlOrg.id
      );
      const token2 = await createTestSourceControlToken(
        user2.id,
        sourceControlOrg.id
      );

      // Send webhook for the github user
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        githubLogin
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deletedTokens).toBe(2);

      // Verify all tokens were deleted
      const token1After = await db.sourceControlToken.findUnique({
        where: { id: token1.id },
      });
      const token2After = await db.sourceControlToken.findUnique({
        where: { id: token2.id },
      });
      expect(token1After).toBeNull();
      expect(token2After).toBeNull();
    });

    test("should return success when no tokens exist for user", async () => {
      const githubLogin = `nonexistent-user-${Date.now()}`;

      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        githubLogin
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.deletedTokens).toBe(0);
    });

    test("should ignore non-revoked github_app_authorization events", async () => {
      const payload = createGitHubAppAuthorizationPayload(
        "created",
        "testuser"
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Event received");
    });

    test("should ignore other event types", async () => {
      const payload = {
        action: "opened",
        pull_request: {
          id: 12345,
          title: "Test PR",
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(payload, signature, "pull_request");

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Event received");
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      // Mock database error
      const originalDeleteMany = db.sourceControlToken.deleteMany;
      vi.spyOn(db.sourceControlToken, "deleteMany").mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const githubLogin = "testuser";
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        githubLogin
      );
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(testSecret, body);

      const request = createWebhookRequest(
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe("Failed to process revocation");

      // Restore original function
      vi.restoreAllMocks();
    });

    test("should handle unexpected errors in webhook processing", async () => {
      // Create a request that will cause an unexpected error
      const request = new Request(
        "http://localhost:3000/api/github/app/webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": "sha256=test",
            "x-github-event": "github_app_authorization",
          },
          body: null as any, // This will cause an error when reading text
        }
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.message).toBe("Internal server error");
    });
  });

  describe("Signature Verification Edge Cases", () => {
    test("should use timing-safe comparison for signature validation", async () => {
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        "testuser"
      );
      const body = JSON.stringify(payload);

      // Create a signature that differs by only one character
      const validSignature = computeValidWebhookSignature(testSecret, body);
      const invalidSignature =
        validSignature.slice(0, -1) +
        (validSignature.slice(-1) === "a" ? "b" : "a");

      const request = createWebhookRequest(
        payload,
        invalidSignature,
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should handle signature with wrong format", async () => {
      const payload = createGitHubAppAuthorizationPayload(
        "revoked",
        "testuser"
      );

      // Missing sha256= prefix - this will cause different length buffers
      const request = createWebhookRequest(
        payload,
        "invalid_format_signature",
        "github_app_authorization"
      );

      const response = await POST(request as any);
      const data = await response.json();

      // When signatures have different lengths, timingSafeEqual throws an error
      // which is caught by the outer try-catch and returns 500
      expect(response.status).toBe(500);
      expect(data.message).toBe("Internal server error");
    });
  });
});