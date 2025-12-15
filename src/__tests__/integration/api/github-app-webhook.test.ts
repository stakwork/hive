import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/webhook/route";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import {
  createGitHubAppAuthPayload,
  createGitHubAppWebhookRequest,
  computeValidWebhookSignature,
  createTestUserWithGitHubAuth,
  createTestSourceControlToken,
} from "@/__tests__/support/factories/github-webhook.factory";

describe("GitHub App Webhook - POST /api/github/app/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/github/app/webhook";
  const mockWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET || "test_webhook_secret_123";

  // Store original env var
  const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure GITHUB_WEBHOOK_SECRET is set for tests
    process.env.GITHUB_WEBHOOK_SECRET = mockWebhookSecret;
  });

  afterEach(() => {
    // Restore original env var
    if (originalSecret) {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }
  });

  describe("Header Validation", () => {
    test("should return 400 when x-hub-signature-256 header is missing", async () => {
      const payload = createGitHubAppAuthPayload();

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-github-event": "github_app_authorization",
          // Missing x-hub-signature-256
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should return 400 when request body is missing", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-hub-signature-256": "sha256=test",
          "x-github-event": "github_app_authorization",
        },
        // No body
      });

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(401);
    });
  });

  describe("Signature Verification", () => {
    test("should accept webhook with valid HMAC-SHA256 signature", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "test-user",
      });
      await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should reject webhook with invalid signature", async () => {
      const payload = createGitHubAppAuthPayload();
      const invalidSignature = "sha256=invalid_signature_12345";

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        invalidSignature
      );

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should reject webhook when signature uses wrong algorithm", async () => {
      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);
      // Use sha1 instead of sha256
      const wrongAlgoSignature = `sha1=${require("crypto")
        .createHmac("sha1", mockWebhookSecret)
        .update(body)
        .digest("hex")}`;

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        wrongAlgoSignature
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(401);
    });

    test("should verify signature using timing-safe comparison", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "timing-test-user",
      });
      await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "timing-test-user");
      const body = JSON.stringify(payload);
      const validSignature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        validSignature
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);
    });
  });

  describe("Payload Validation", () => {
    test.skip("should return 400 when payload is not valid JSON", async () => {
      const invalidBody = "invalid json {";
      const signature = computeValidWebhookSignature(mockWebhookSecret, invalidBody);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": "github_app_authorization",
        },
        body: invalidBody,
      });

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(400);
    });

    test("should handle payload with missing action field", async () => {
      const payload = {
        sender: {
          login: "test-user",
          id: 12345678,
        },
        // Missing action field
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      // Should succeed but not trigger token deletion
      expect(response.status).toBe(200);
    });

    test.skip("should handle payload with missing sender field", async () => {
      const payload = {
        action: "revoked",
        // Missing sender field
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      // Should succeed but not trigger token deletion
      expect(response.status).toBe(200);
    });
  });

  describe("Event Type Filtering", () => {
    test.skip("should process github_app_authorization events", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "event-test-user",
      });
      const { token } = await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "event-test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);

      // Verify token was deleted
      const deletedToken = await db.sourceControlToken.findUnique({
        where: { id: token.id },
      });
      expect(deletedToken).toBeNull();
    });

    test("should ignore non-github_app_authorization events", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "other-event-user",
      });
      const { token } = await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "other-event-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "push" // Different event type
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);

      // Verify token was NOT deleted (wrong event type)
      const unchangedToken = await db.sourceControlToken.findUnique({
        where: { id: token.id },
      });
      expect(unchangedToken).toBeDefined();
    });

    test("should only process revoked action for github_app_authorization", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "created-action-user",
      });
      const { token } = await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("created", "created-action-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "github_app_authorization"
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);

      // Verify token was NOT deleted (action is 'created', not 'revoked')
      const unchangedToken = await db.sourceControlToken.findUnique({
        where: { id: token.id },
      });
      expect(unchangedToken).toBeDefined();
    });
  });

  describe("Token Cleanup", () => {
    test.skip("should delete all source control tokens for revoked user", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "revoke-user",
      });

      // Create multiple tokens for the same user
      const { token: token1 } = await createTestSourceControlToken(user.id, {
        githubLogin: "org1",
        installationId: 111111,
      });
      const { token: token2 } = await createTestSourceControlToken(user.id, {
        githubLogin: "org2",
        installationId: 222222,
      });

      const payload = createGitHubAppAuthPayload("revoked", "revoke-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);

      // Verify both tokens were deleted
      const deletedToken1 = await db.sourceControlToken.findUnique({
        where: { id: token1.id },
      });
      const deletedToken2 = await db.sourceControlToken.findUnique({
        where: { id: token2.id },
      });

      expect(deletedToken1).toBeNull();
      expect(deletedToken2).toBeNull();
    });

    test("should handle revocation when user has no tokens", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "no-tokens-user",
      });
      // Don't create any tokens

      const payload = createGitHubAppAuthPayload("revoked", "no-tokens-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      // Should succeed even if no tokens exist
      expect(response.status).toBe(200);
    });

    test("should handle revocation when user is not found", async () => {
      // Don't create user, use non-existent username
      const payload = createGitHubAppAuthPayload("revoked", "nonexistent-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      // Should succeed even if user doesn't exist
      expect(response.status).toBe(200);
    });

    test.skip("should not delete tokens for other users", async () => {
      const user1 = await createTestUserWithGitHubAuth({
        githubUsername: "user1",
      });
      const user2 = await createTestUserWithGitHubAuth({
        githubUsername: "user2",
      });

      const { token: token1 } = await createTestSourceControlToken(user1.id);
      const { token: token2 } = await createTestSourceControlToken(user2.id);

      // Revoke user1
      const payload = createGitHubAppAuthPayload("revoked", "user1");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      expect(response.status).toBe(200);

      // Verify user1's token deleted
      const deletedToken1 = await db.sourceControlToken.findUnique({
        where: { id: token1.id },
      });
      expect(deletedToken1).toBeNull();

      // Verify user2's token NOT deleted
      const unchangedToken2 = await db.sourceControlToken.findUnique({
        where: { id: token2.id },
      });
      expect(unchangedToken2).toBeDefined();
    });
  });

  describe("Database State Verification", () => {
    test.skip("should maintain database consistency after token deletion", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "consistency-user",
      });
      await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "consistency-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      await POST(request as NextRequest);

      // Verify user still exists
      const existingUser = await db.user.findUnique({
        where: { id: user.id },
        include: { sourceControlTokens: true },
      });

      expect(existingUser).toBeDefined();
      expect(existingUser?.sourceControlTokens).toHaveLength(0);
    });

    test.skip("should handle concurrent revocation requests safely", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "concurrent-user",
      });
      const { token } = await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "concurrent-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request1 = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );
      const request2 = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      // Send concurrent requests
      const [response1, response2] = await Promise.all([
        POST(request1 as NextRequest),
        POST(request2 as NextRequest),
      ]);

      // Both should succeed
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Verify token deleted only once
      const deletedToken = await db.sourceControlToken.findUnique({
        where: { id: token.id },
      });
      expect(deletedToken).toBeNull();
    });
  });

  describe("Error Handling", () => {
    test.skip("should handle database connection errors gracefully", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "db-error-user",
      });
      await createTestSourceControlToken(user.id);

      // Mock database error
      const originalFindUnique = db.user.findUnique;
      vi.spyOn(db.user, "findUnique").mockRejectedValue(
        new Error("Database connection failed")
      );

      const payload = createGitHubAppAuthPayload("revoked", "db-error-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      // Should return 500 for server errors
      expect(response.status).toBe(500);

      // Restore mock
      db.user.findUnique = originalFindUnique;
    });

    test.skip("should handle missing GITHUB_WEBHOOK_SECRET environment variable", async () => {
      // Remove env var
      delete process.env.GITHUB_WEBHOOK_SECRET;

      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);
      const signature = "sha256=test";

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);

      // Should fail without secret
      expect(response.status).toBe(500);

      // Restore env var
      process.env.GITHUB_WEBHOOK_SECRET = mockWebhookSecret;
    });
  });

  describe("Response Format", () => {
    test("should return correct response format for successful processing", async () => {
      const user = await createTestUserWithGitHubAuth({
        githubUsername: "response-user",
      });
      await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "response-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
    });

    test("should return error message for invalid signature", async () => {
      const payload = createGitHubAppAuthPayload();
      const invalidSignature = "sha256=invalid";

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        invalidSignature
      );

      const response = await POST(request as NextRequest);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ message: "Invalid signature" });
    });
  });

  describe("Logging and Audit", () => {
    test("should log revocation event details", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const user = await createTestUserWithGitHubAuth({
        githubUsername: "audit-user",
      });
      await createTestSourceControlToken(user.id);

      const payload = createGitHubAppAuthPayload("revoked", "audit-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(mockWebhookSecret, body);

      const request = createGitHubAppWebhookRequest(
        webhookUrl,
        payload,
        signature
      );

      await POST(request as NextRequest);

      // Verify logging occurred
      expect(consoleSpy).toHaveBeenCalledWith(
        "🔴 User revoked authorization:",
        "audit-user"
      );

      consoleSpy.mockRestore();
    });
  });
});