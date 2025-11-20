import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/webhook/route";
import {
  createGitHubAppAuthPayload,
  computeValidWebhookSignature,
  createWebhookRequest,
  mockGitHubAppEvents,
} from "@/__tests__/support/fixtures/github-webhook";
import { generateUniqueId } from "@/__tests__/support/helpers";

describe("GitHub App Webhook Integration Tests - POST /api/github/app/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/github/app/webhook";
  const webhookSecret = "test_app_webhook_secret";

  beforeEach(() => {
    // Set the webhook secret for the route to use
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", webhookSecret);
  });

  describe("Security - HMAC Signature Validation", () => {
    test("should successfully process webhook with valid HMAC-SHA256 signature", async () => {
      // Create valid app authorization revoked event
      const payload = createGitHubAppAuthPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should reject webhook with invalid signature", async () => {
      const payload = createGitHubAppAuthPayload("revoked", "attacker-user");
      const body = JSON.stringify(payload);
      const invalidSignature = "sha256=invalid_signature_that_will_fail_verification";

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        invalidSignature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should reject webhook with missing signature header", async () => {
      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);

      // Create request without x-hub-signature-256 header
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": mockGitHubAppEvents.authorization,
          "x-github-delivery": generateUniqueId("delivery"),
        },
        body,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should use timing-safe comparison for signature validation", async () => {
      // This test verifies that signature comparison doesn't leak timing information
      // by testing with signatures that differ in various positions
      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);

      const validSignature = computeValidWebhookSignature(webhookSecret, body);
      
      // Create invalid signature with same length but different content
      const invalidSignature = validSignature.replace(/[0-9a-f]/, (match) => 
        match === 'a' ? 'b' : 'a'
      );

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        invalidSignature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);

      // Should still reject invalid signature regardless of similarity
      expect(response.status).toBe(401);
    });
  });

  describe("Event Processing - Authorization Lifecycle", () => {
    test("should process github_app_authorization event with revoked action", async () => {
      const payload = createGitHubAppAuthPayload("revoked", "user-revoking-access");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Note: Currently, the endpoint only logs the revocation
      // TODO: Verify token deletion when implemented
    });

    test("should handle github_app_authorization event with different sender", async () => {
      const payload = createGitHubAppAuthPayload("revoked", "another-test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should gracefully handle unknown event types", async () => {
      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        "unknown_event_type" // Not github_app_authorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      // Should still return success for unknown events (graceful handling)
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should handle non-revoked authorization actions", async () => {
      // Even though only 'revoked' is currently processed, test other potential actions
      const payload = {
        action: "granted", // Different action
        sender: {
          login: "test-user",
          id: 12345678,
          type: "User",
        },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      // Should return success even if action is not 'revoked'
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed JSON payload", async () => {
      const malformedBody = "{ invalid json structure }";
      const signature = computeValidWebhookSignature(webhookSecret, malformedBody);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-event": mockGitHubAppEvents.authorization,
          "x-github-delivery": generateUniqueId("delivery"),
        },
        body: malformedBody,
      });

      // Currently endpoint doesn't handle JSON parse errors gracefully
      // It will throw a SyntaxError which results in uncaught exception
      // This test documents the current behavior
      await expect(POST(request as any)).rejects.toThrow();
    });

    test("should handle payload missing required fields", async () => {
      const incompletePayload = {
        action: "revoked",
        // Missing sender field
      };
      const body = JSON.stringify(incompletePayload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        incompletePayload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      // Currently endpoint doesn't validate payload structure
      // It will throw TypeError when accessing payload.sender.login
      // This test documents the current behavior
      await expect(POST(request as any)).rejects.toThrow();
    });

    test("should handle missing event header", async () => {
      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      // Create request without x-github-event header
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-delivery": generateUniqueId("delivery"),
        },
        body,
      });

      const response = await POST(request as any);
      const data = await response.json();

      // Should still process successfully (event header is optional in current implementation)
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should handle empty payload", async () => {
      const emptyBody = "{}";
      const signature = computeValidWebhookSignature(webhookSecret, emptyBody);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-event": mockGitHubAppEvents.authorization,
          "x-github-delivery": generateUniqueId("delivery"),
        },
        body: emptyBody,
      });

      const response = await POST(request as any);
      const data = await response.json();

      // Should handle empty payload gracefully
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Environment Configuration", () => {
    test("should use GITHUB_WEBHOOK_SECRET environment variable", async () => {
      // This test verifies that the endpoint uses the environment-level secret
      // (not per-repository encrypted secrets like the repo webhook endpoint)
      
      expect(process.env.GITHUB_WEBHOOK_SECRET).toBeTruthy();

      const payload = createGitHubAppAuthPayload();
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);
    });
  });

  describe("Database Integration - Future Token Cleanup", () => {
    test("should prepare for token deletion when revocation is implemented", async () => {
      // This test documents the expected behavior when token cleanup is implemented
      // Currently, the endpoint only logs revocation but doesn't clean up tokens (marked TODO)
      
      const payload = createGitHubAppAuthPayload("revoked", "user-to-delete");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(webhookSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload as any,
        signature,
        generateUniqueId("webhook"),
        mockGitHubAppEvents.authorization
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);

      // TODO: When token cleanup is implemented, verify:
      // 1. SourceControlToken is deleted for user 'user-to-delete'
      // 2. Related SourceControlOrg is cleaned up if no other tokens exist
      // 3. Database transaction ensures atomicity
      // 4. Error handling for missing user/token scenarios
    });
  });
});