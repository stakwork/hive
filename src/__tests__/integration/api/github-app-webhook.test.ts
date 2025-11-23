import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { NextRequest } from "next/server";
import crypto from "crypto";

// Mock environment variables
const GITHUB_WEBHOOK_SECRET = "test_webhook_secret_for_github_app";

describe("GitHub App Webhook Integration Tests - POST /api/github/app/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = GITHUB_WEBHOOK_SECRET;
  });

  // Helper to compute valid HMAC-SHA256 signature
  const computeValidSignature = (payload: string, secret: string): string => {
    const hmac = crypto.createHmac("sha256", secret);
    return `sha256=${hmac.update(payload).digest("hex")}`;
  };

  // Helper to create webhook request
  const createWebhookRequest = (
    payload: object,
    signature: string,
    eventType: string = "github_app_authorization"
  ): NextRequest => {
    const body = JSON.stringify(payload);
    return new NextRequest("http://localhost:3000/api/github/app/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": eventType,
      },
      body,
    });
  };

  // Helper to create authorization revoked payload
  const createAuthorizationRevokedPayload = (username: string) => ({
    action: "revoked",
    sender: {
      login: username,
      id: 12345,
      type: "User",
    },
  });

  // Helper to create installation deleted payload
  const createInstallationDeletedPayload = (installationId: number) => ({
    action: "deleted",
    installation: {
      id: installationId,
      account: {
        login: "test-org",
        type: "Organization",
      },
    },
    sender: {
      login: "test-user",
      id: 67890,
    },
  });

  describe("Signature Validation", () => {
    test("should accept webhook with valid HMAC-SHA256 signature", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should reject webhook with invalid signature", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      // Use a properly formatted but incorrect signature (64 hex chars after sha256=)
      const invalidSignature = "sha256=" + "0".repeat(64);

      const request = createWebhookRequest(payload, invalidSignature);
      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe("Invalid signature");
    });

    test("should reject webhook with missing signature header", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      const body = JSON.stringify(payload);

      const request = new NextRequest("http://localhost:3000/api/github/app/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GitHub-Event": "github_app_authorization",
        },
        body,
      });

      const response = await POST(request);

      // timingSafeEqual throws when buffer lengths differ, caught by outer try-catch
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toBe("Internal server error");
    });

    test("should reject webhook with malformed signature format", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      const malformedSignature = "invalid_format_no_sha256_prefix";

      const request = createWebhookRequest(payload, malformedSignature);
      const response = await POST(request);

      // timingSafeEqual throws when buffer lengths differ, caught by outer try-catch
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toBe("Internal server error");
    });

    test("should use timing-safe comparison for signature validation", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      const body = JSON.stringify(payload);
      const validSignature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);
      
      // Slightly modified signature (different at the end)
      const almostValidSignature = validSignature.slice(0, -2) + "XX";

      const request = createWebhookRequest(payload, almostValidSignature);
      const response = await POST(request);

      // Should still reject even with small difference
      expect(response.status).toBe(401);
    });
  });

  describe("Authorization Revocation Events", () => {
    test("should detect authorization revoked event", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should delete user tokens on authorization revocation", async () => {
      // Create test user with SourceControlOrg and tokens
      const user = await db.user.create({
        data: {
          name: "Revocation Test User",
          email: `revocation-test-${Date.now()}@example.com`,
        },
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: "USER",
          githubLogin: "revocation-user",
          githubInstallationId: 111222333,
          name: "Revocation User",
        },
      });

      const encryptionService = EncryptionService.getInstance();
      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "test_access_token"
      );

      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });

      // Verify token exists before revocation
      const tokenBefore = await db.sourceControlToken.findUnique({
        where: {
          userId_sourceControlOrgId: {
            userId: user.id,
            sourceControlOrgId: sourceControlOrg.id,
          },
        },
      });
      expect(tokenBefore).toBeTruthy();

      // Send revocation webhook
      const payload = createAuthorizationRevokedPayload("revocation-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify token was deleted
      const tokenAfter = await db.sourceControlToken.findUnique({
        where: {
          userId_sourceControlOrgId: {
            userId: user.id,
            sourceControlOrgId: sourceControlOrg.id,
          },
        },
      });
      expect(tokenAfter).toBeNull();
    });

    test("should handle revocation for user without tokens gracefully", async () => {
      const payload = createAuthorizationRevokedPayload("nonexistent-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      // Should succeed even if no tokens found
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should delete multiple tokens for user with multiple installations", async () => {
      const timestamp = Date.now();
      const user = await db.user.create({
        data: {
          name: "Multi Token User",
          email: `multi-token-${timestamp}@example.com`,
        },
      });

      const org1 = await db.sourceControlOrg.create({
        data: {
          type: "USER",
          githubLogin: `multi-token-user-${timestamp}`,
          githubInstallationId: 444555666,
          name: "Multi Token User Org 1",
        },
      });

      const org2 = await db.sourceControlOrg.create({
        data: {
          type: "ORG",
          githubLogin: `multi-token-org-${timestamp}`,
          githubInstallationId: 777888999,
          name: "Multi Token User Org 2",
        },
      });

      const encryptionService = EncryptionService.getInstance();

      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: org1.id,
          token: JSON.stringify(
            encryptionService.encryptField("source_control_token", "token1")
          ),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });

      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: org2.id,
          token: JSON.stringify(
            encryptionService.encryptField("source_control_token", "token2")
          ),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });

      // Verify both tokens exist
      const tokensBefore = await db.sourceControlToken.findMany({
        where: { userId: user.id },
      });
      expect(tokensBefore).toHaveLength(2);

      // Send revocation webhook - note: this will only match the first org
      // In reality, both orgs would need to have the same githubLogin to be deleted
      // This test verifies that tokens are deleted for matching orgs
      const payload = createAuthorizationRevokedPayload(`multi-token-user-${timestamp}`);
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Only the token for org1 should be deleted (matching githubLogin)
      const tokensAfter = await db.sourceControlToken.findMany({
        where: { userId: user.id },
      });
      expect(tokensAfter).toHaveLength(1);
    });
  });

  describe("Installation Events", () => {
    test("should handle installation deleted event", async () => {
      const payload = createInstallationDeletedPayload(123456);
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature, "installation");
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should handle installation created event", async () => {
      const payload = {
        action: "created",
        installation: {
          id: 789012,
          account: {
            login: "new-org",
            type: "Organization",
          },
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature, "installation");
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should handle installation suspended event", async () => {
      const payload = {
        action: "suspend",
        installation: {
          id: 345678,
          account: {
            login: "suspended-org",
            type: "Organization",
          },
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature, "installation");
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should handle installation unsuspended event", async () => {
      const payload = {
        action: "unsuspend",
        installation: {
          id: 901234,
          account: {
            login: "unsuspended-org",
            type: "Organization",
          },
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature, "installation");
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Installation Repository Events", () => {
    test("should handle repositories added event", async () => {
      const payload = {
        action: "added",
        installation: {
          id: 567890,
        },
        repositories_added: [
          {
            id: 111,
            name: "new-repo",
            full_name: "org/new-repo",
          },
        ],
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(
        payload,
        signature,
        "installation_repositories"
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should handle repositories removed event", async () => {
      const payload = {
        action: "removed",
        installation: {
          id: 567890,
        },
        repositories_removed: [
          {
            id: 222,
            name: "old-repo",
            full_name: "org/old-repo",
          },
        ],
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(
        payload,
        signature,
        "installation_repositories"
      );
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed JSON payload", async () => {
      const malformedBody = '{"action": "revoked", "sender": {';
      const signature = computeValidSignature(malformedBody, GITHUB_WEBHOOK_SECRET);

      const request = new NextRequest("http://localhost:3000/api/github/app/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
          "X-GitHub-Event": "github_app_authorization",
        },
        body: malformedBody,
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("Invalid payload");
    });

    test("should handle missing event type header", async () => {
      const payload = createAuthorizationRevokedPayload("test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = new NextRequest("http://localhost:3000/api/github/app/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
        },
        body,
      });

      const response = await POST(request);

      // Should still succeed but may log warning
      expect(response.status).toBe(200);
    });

    test("should handle database errors during token deletion gracefully", async () => {
      // Create user and org so the code reaches the deleteMany call
      const user = await db.user.create({
        data: {
          name: "Error Test User",
          email: `error-test-${Date.now()}@example.com`,
        },
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: "USER",
          githubLogin: "error-user",
          githubInstallationId: 555666777,
          name: "Error User",
        },
      });

      const encryptionService = EncryptionService.getInstance();
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            encryptionService.encryptField("source_control_token", "token")
          ),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });

      // Mock database error
      const originalDeleteMany = db.sourceControlToken.deleteMany;
      vi.spyOn(db.sourceControlToken, "deleteMany").mockRejectedValue(
        new Error("Database connection failed")
      );

      const payload = createAuthorizationRevokedPayload("error-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      // Should return 500 on database error
      expect(response.status).toBe(500);

      // Restore original function
      db.sourceControlToken.deleteMany = originalDeleteMany;
    });

    test("should handle empty payload", async () => {
      const emptyPayload = {};
      const body = JSON.stringify(emptyPayload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(emptyPayload, signature);
      const response = await POST(request);

      // Should succeed with empty payload
      expect(response.status).toBe(200);
    });

    test("should handle unknown event types gracefully", async () => {
      const payload = {
        action: "unknown_action",
        sender: {
          login: "test-user",
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature, "unknown_event");
      const response = await POST(request);

      // Should succeed but take no action
      expect(response.status).toBe(200);
    });
  });

  describe("Edge Cases", () => {
    test("should handle payload with missing sender login", async () => {
      const payload = {
        action: "revoked",
        sender: {
          id: 12345,
          type: "User",
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      // Should handle gracefully
      expect(response.status).toBe(200);
    });

    test("should handle very long sender login", async () => {
      const longLogin = "a".repeat(1000);
      const payload = createAuthorizationRevokedPayload(longLogin);
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should handle special characters in sender login", async () => {
      const specialLogin = "user-with-special_chars.123";
      const payload = createAuthorizationRevokedPayload(specialLogin);
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should handle concurrent revocation requests", async () => {
      const user = await db.user.create({
        data: {
          name: "Concurrent User",
          email: `concurrent-${Date.now()}@example.com`,
        },
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: "USER",
          githubLogin: "concurrent-user",
          githubInstallationId: 999000111,
          name: "Concurrent User",
        },
      });

      const encryptionService = EncryptionService.getInstance();
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            encryptionService.encryptField("source_control_token", "token")
          ),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });

      const payload = createAuthorizationRevokedPayload("concurrent-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      // Send two concurrent requests
      const request1 = createWebhookRequest(payload, signature);
      const request2 = createWebhookRequest(payload, signature);

      const [response1, response2] = await Promise.all([
        POST(request1),
        POST(request2),
      ]);

      // Both should succeed
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Token should be deleted
      const tokensAfter = await db.sourceControlToken.findMany({
        where: { userId: user.id },
      });
      expect(tokensAfter).toHaveLength(0);
    });

    test("should handle case-sensitive sender login matching", async () => {
      const user = await db.user.create({
        data: {
          name: "Case Test User",
          email: `case-test-${Date.now()}@example.com`,
        },
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: "USER",
          githubLogin: "CaseSensitiveUser",
          githubInstallationId: 222333444,
          name: "Case Sensitive User",
        },
      });

      const encryptionService = EncryptionService.getInstance();
      await db.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            encryptionService.encryptField("source_control_token", "token")
          ),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });

      // Send revocation with different case
      const payload = createAuthorizationRevokedPayload("casesensitiveuser");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      await POST(request);

      // Token should NOT be deleted due to case mismatch
      const tokensAfter = await db.sourceControlToken.findMany({
        where: { userId: user.id },
      });
      expect(tokensAfter).toHaveLength(1);
    });
  });

  describe("Security", () => {
    test("should not accept requests with missing GITHUB_WEBHOOK_SECRET", async () => {
      const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
      delete process.env.GITHUB_WEBHOOK_SECRET;

      const payload = createAuthorizationRevokedPayload("test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.message).toContain("Webhook secret not configured");

      // Restore secret
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    });

    test("should log revocation events for audit trail", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");

      const payload = createAuthorizationRevokedPayload("audit-user");
      const body = JSON.stringify(payload);
      const signature = computeValidSignature(body, GITHUB_WEBHOOK_SECRET);

      const request = createWebhookRequest(payload, signature);
      await POST(request);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("User revoked authorization"),
        "audit-user"
      );

      consoleLogSpy.mockRestore();
    });
  });
});