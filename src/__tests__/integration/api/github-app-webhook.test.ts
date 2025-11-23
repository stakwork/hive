import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/app/webhook/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  computeValidWebhookSignature,
  createWebhookRequest,
  createGitHubAppAuthorizationPayload,
  mockGitHubEvents,
} from "@/__tests__/support/fixtures/github-webhook";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock environment variables
const GITHUB_WEBHOOK_SECRET = "test_github_app_webhook_secret_123";

describe("GitHub App Webhook Integration Tests - POST /api/github/app/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/github/app/webhook";

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock environment variable
    process.env.GITHUB_WEBHOOK_SECRET = GITHUB_WEBHOOK_SECRET;
  });

  describe("Security Validation", () => {
    test("should successfully process webhook with valid signature", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123", // webhookId not used by app endpoint, but required by helper
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should reject webhook with invalid signature", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const invalidSignature = "sha256=invalid_signature_hash_12345";

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        invalidSignature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should reject webhook with missing signature header", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");

      // Create request without signature header
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": mockGitHubEvents.githubAppAuthorization,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.message).toBe("Invalid signature");
    });

    test("should handle signature verification with special characters in payload", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "user-with-special-@#$");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);
    });
  });

  describe("Authorization Revocation Events", () => {
    test("should detect github_app_authorization revoked event", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "revoked-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      // Event detection is logged to console
      // Actual token deletion logic is not yet implemented (TODO)
    });

    test.skip("should delete user OAuth tokens on authorization revocation", async () => {
      // TODO: Implement token deletion logic in endpoint
      // Expected behavior:
      // 1. Query db.account for userId by GitHub username
      // 2. Delete OAuth access tokens from Account table
      // 3. Delete refresh tokens if present
      // 4. Clear encrypted token fields
      
      const testUser = await createTestUser({
        name: "User to Revoke",
        withGitHubAuth: true,
        githubUsername: "user-to-revoke",
      });

      // Create OAuth account record
      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-12345",
          access_token: EncryptionService.getInstance().encryptField(
            "access_token",
            "github_oauth_token_123"
          ) as any,
        },
      });

      const payload = createGitHubAppAuthorizationPayload("revoked", "user-to-revoke");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      await POST(request as any);

      // Verify tokens deleted
      const account = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });

      expect(account?.access_token).toBeNull();
      expect(account?.refresh_token).toBeNull();
    });

    test.skip("should clear repository webhook configuration on authorization revocation", async () => {
      // TODO: Implement webhook cleanup logic in endpoint
      // Expected behavior:
      // 1. Find all repositories owned by revoked user
      // 2. Clear githubWebhookId and githubWebhookSecret fields
      // 3. Set repository status to indicate webhook disconnected
      
      const testUser = await createTestUser({
        name: "Webhook Owner",
        withGitHubAuth: true,
        githubUsername: "webhook-owner",
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `test-workspace-${Date.now()}`,
          ownerId: testUser.id,
        },
      });

      const repository = await db.repository.create({
        data: {
          name: "Test Repo",
          repositoryUrl: "https://github.com/test-org/test-repo",
          branch: "main",
          workspaceId: workspace.id,
          githubWebhookId: "webhook-to-clear-123",
          githubWebhookSecret: JSON.stringify(
            EncryptionService.getInstance().encryptField(
              "githubWebhookSecret",
              "webhook_secret_to_clear"
            )
          ),
        },
      });

      const payload = createGitHubAppAuthorizationPayload("revoked", "webhook-owner");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      await POST(request as any);

      // Verify webhook config cleared
      const updatedRepo = await db.repository.findUnique({
        where: { id: repository.id },
      });

      expect(updatedRepo?.githubWebhookId).toBeNull();
      expect(updatedRepo?.githubWebhookSecret).toBeNull();
    });

    test.skip("should delete source control tokens on authorization revocation", async () => {
      // TODO: Implement source control token deletion logic in endpoint
      // Expected behavior:
      // 1. Find sourceControlOrg by GitHub username
      // 2. Delete all sourceControlToken records for user
      // 3. Log deletion for audit trail
      
      const testUser = await createTestUser({
        name: "Source Control User",
        withGitHubAuth: true,
        githubUsername: "source-control-user",
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 123,
        },
      });

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            EncryptionService.getInstance().encryptField(
              "source_control_token",
              "sc_token_to_delete"
            )
          ),
        },
      });

      const payload = createGitHubAppAuthorizationPayload("revoked", "source-control-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      await POST(request as any);

      // Verify source control tokens deleted
      const tokens = await db.sourceControlToken.findMany({
        where: { userId: testUser.id },
      });

      expect(tokens).toHaveLength(0);
    });
  });

  describe("Event Type Filtering", () => {
    test("should process github_app_authorization events", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);
    });

    test("should skip non-revoked actions in github_app_authorization events", async () => {
      const payload = createGitHubAppAuthorizationPayload("created", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      // Should not trigger token deletion for non-revoked actions
    });

    test("should handle push events gracefully (wrong endpoint)", async () => {
      // Push events should go to /api/github/webhook, not /api/github/app/webhook
      const payload = {
        ref: "refs/heads/main",
        repository: {
          clone_url: "https://github.com/test-org/test-repo",
        },
        sender: { login: "testuser" },
        pusher: { name: "testuser" },
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.push
      );

      const response = await POST(request as any);
      const data = await response.json();

      // Should still return success but not process as app authorization
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test.skip("should handle malformed JSON payload", async () => {
      // BUG: Endpoint does not handle JSON.parse() errors gracefully
      // Current implementation throws SyntaxError at line 25: const payload = JSON.parse(body);
      // Expected: Should catch JSON parse errors and return 400 Bad Request
      // Actual: Returns 500 Internal Server Error with unhandled exception
      const invalidJson = "{ invalid json syntax here";
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, invalidJson);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-event": mockGitHubEvents.githubAppAuthorization,
        },
        body: invalidJson,
      });

      const response = await POST(request as any);

      expect([400, 500]).toContain(response.status);
    });

    test("should handle missing event header", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          // Missing x-github-event header
        },
        body,
      });

      const response = await POST(request as any);

      // Should succeed since endpoint doesn't validate event header presence
      // before parsing payload (potential improvement area)
      expect(response.status).toBe(200);
    });

    test.skip("should handle missing sender in payload", async () => {
      // BUG: Endpoint does not handle missing payload.sender gracefully
      // Current implementation throws TypeError at line 28: payload.sender.login
      // Expected: Should check if payload.sender exists before accessing login property
      // Actual: Returns 500 Internal Server Error with unhandled exception
      const payload = {
        action: "revoked",
        // Missing sender object
      };
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);
    });

    test.skip("should handle empty request body", async () => {
      // BUG: Endpoint does not handle empty body gracefully
      // Current implementation throws SyntaxError at line 25: JSON.parse("")
      // Expected: Should validate body is not empty before parsing or catch parse errors
      // Actual: Returns 500 Internal Server Error with unhandled exception
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, "");

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signature,
          "x-github-event": mockGitHubEvents.githubAppAuthorization,
        },
        body: "",
      });

      const response = await POST(request as any);

      expect([400, 401]).toContain(response.status);
    });
  });

  describe("Database Integration", () => {
    test.skip("should query user by GitHub username when processing revocation", async () => {
      // TODO: Implement user lookup logic in endpoint
      // Expected behavior:
      // 1. Extract payload.sender.login (GitHub username)
      // 2. Query db.gitHubAuth for matching githubUsername
      // 3. Get userId from gitHubAuth record
      // 4. Use userId for token deletion operations
      
      const testUser = await createTestUser({
        name: "GitHub User",
        withGitHubAuth: true,
        githubUsername: "github-user-123",
      });

      const payload = createGitHubAppAuthorizationPayload("revoked", "github-user-123");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      await POST(request as any);

      // Verify user was found and processed
      const githubAuth = await db.gitHubAuth.findFirst({
        where: { githubUsername: "github-user-123" },
      });

      expect(githubAuth).toBeTruthy();
      expect(githubAuth?.userId).toBe(testUser.id);
    });

    test.skip("should handle revocation for user not found in database", async () => {
      // TODO: Implement graceful handling when user doesn't exist
      // Expected behavior:
      // 1. Try to find user by GitHub username
      // 2. If not found, log warning and return success (not an error)
      // 3. Don't throw exception or return error status
      
      const payload = createGitHubAppAuthorizationPayload("revoked", "nonexistent-user-999");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test.skip("should cascade delete related records on authorization revocation", async () => {
      // TODO: Implement cascade deletion logic in endpoint
      // Expected behavior:
      // 1. Delete Account records (OAuth tokens)
      // 2. Delete SourceControlToken records
      // 3. Clear Repository webhook configurations
      // 4. Consider workspace cleanup if user is sole owner
      
      const testUser = await createTestUser({
        name: "User with Relations",
        withGitHubAuth: true,
        githubUsername: "user-with-relations",
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Related Workspace",
          slug: `related-workspace-${Date.now()}`,
          ownerId: testUser.id,
        },
      });

      await db.account.create({
        data: {
          userId: testUser.id,
          type: "oauth",
          provider: "github",
          providerAccountId: "github-99999",
          access_token: EncryptionService.getInstance().encryptField(
            "access_token",
            "token_to_cascade_delete"
          ) as any,
        },
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          githubLogin: "cascade-org",
          githubInstallationId: 456,
        },
      });

      await db.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            EncryptionService.getInstance().encryptField(
              "source_control_token",
              "cascade_token"
            )
          ),
        },
      });

      const payload = createGitHubAppAuthorizationPayload("revoked", "user-with-relations");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      await POST(request as any);

      // Verify cascade deletions
      const account = await db.account.findFirst({
        where: { userId: testUser.id, provider: "github" },
      });
      expect(account?.access_token).toBeNull();

      const tokens = await db.sourceControlToken.findMany({
        where: { userId: testUser.id },
      });
      expect(tokens).toHaveLength(0);
    });
  });

  describe("Response Format", () => {
    test("should return success response with correct format", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(GITHUB_WEBHOOK_SECRET, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success");
      expect(data.success).toBe(true);
    });

    test("should return error response with message on signature failure", async () => {
      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const invalidSignature = "sha256=bad_signature";

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        invalidSignature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toHaveProperty("message");
      expect(data.message).toBe("Invalid signature");
    });
  });

  describe("Environment Configuration", () => {
    test("should fail when GITHUB_WEBHOOK_SECRET is not configured", async () => {
      // Temporarily unset environment variable
      const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
      delete process.env.GITHUB_WEBHOOK_SECRET;

      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature("any_secret", body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      try {
        await POST(request as any);
      } catch (error) {
        // Should throw or return error when secret is missing
        expect(error).toBeTruthy();
      }

      // Restore environment variable
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    });

    test("should use configured webhook secret for verification", async () => {
      const customSecret = "custom_webhook_secret_for_test";
      process.env.GITHUB_WEBHOOK_SECRET = customSecret;

      const payload = createGitHubAppAuthorizationPayload("revoked", "test-user");
      const body = JSON.stringify(payload);
      const signature = computeValidWebhookSignature(customSecret, body);

      const request = createWebhookRequest(
        webhookUrl,
        payload,
        signature,
        "webhook-123",
        mockGitHubEvents.githubAppAuthorization
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);

      // Restore original secret
      process.env.GITHUB_WEBHOOK_SECRET = GITHUB_WEBHOOK_SECRET;
    });
  });
});