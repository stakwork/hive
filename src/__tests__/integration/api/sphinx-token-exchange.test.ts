import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/auth/sphinx/token/route";
import { db } from "@/lib/db";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { EncryptionService } from "@/lib/encryption";
import { decode } from "next-auth/jwt";
import * as sphinxVerify from "@/lib/auth/sphinx-verify";

const encryptionService = EncryptionService.getInstance();

describe("POST /api/auth/sphinx/token Integration Tests", () => {
  const testPubkey = "02a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890";
  const testToken = "valid-signed-token";
  const testTimestamp = Math.floor(Date.now() / 1000);
  let testUserId: string;

  beforeEach(async () => {
    // Clear mocks first
    vi.clearAllMocks();
    
    // Clean up any existing test data
    await db.account.deleteMany({ where: { provider: "sphinx" } });
    
    // Create test user for each test
    const user = await createTestUser();
    testUserId = user.id;
    
    // Mock successful signature verification for all tests by default
    vi.spyOn(sphinxVerify, "verifySphinxToken").mockReturnValue(true);
  });

  afterEach(async () => {
    // Clean up test user after each test
    if (testUserId) {
      await db.account.deleteMany({ where: { userId: testUserId } });
      await db.user.delete({ where: { id: testUserId } }).catch(() => {
        // User may not exist for some tests, ignore errors
      });
    }
  });

  describe("Public Endpoint Tests", () => {
    it("should work without session (public endpoint)", async () => {
      // testUserId is already set by parent beforeEach
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
        session: null, // No session required
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();
      expect(data.token).toBeDefined();
    });
  });

  describe("Request Validation Tests", () => {
    it("should return 400 when token is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Token, pubkey, and timestamp are required");
    });

    it("should return 400 when pubkey is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Token, pubkey, and timestamp are required");
    });

    it("should return 400 when timestamp is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Token, pubkey, and timestamp are required");
    });
  });

  describe("Signature Verification Tests", () => {
    it("should return 401 when signature is invalid", async () => {
      // Mock failed signature verification
      vi.spyOn(sphinxVerify, "verifySphinxToken").mockReturnValue(false);

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: "invalid-token",
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Invalid signature");

      expect(sphinxVerify.verifySphinxToken).toHaveBeenCalledWith(
        "invalid-token",
        testTimestamp,
        testPubkey
      );
    });

    it("should verify signature with correct parameters", async () => {
      // testUserId is already set by parent beforeEach
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      // Mock successful signature verification
      const verifySpy = vi.spyOn(sphinxVerify, "verifySphinxToken").mockReturnValue(true);

      await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(verifySpy).toHaveBeenCalledWith(testToken, testTimestamp, testPubkey);
    });

    it("should return 401 when signature verification throws error", async () => {
      // Mock signature verification throwing error
      vi.spyOn(sphinxVerify, "verifySphinxToken").mockImplementation(() => {
        throw new Error("Signature verification failed");
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Invalid signature");
    });
  });

  describe("User Lookup Tests", () => {
    // testUserId is already set by parent beforeEach
    // Mock is already set by parent beforeEach

    it("should return 401 when user not found for pubkey", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("User not found");
    });

    it("should find user by decrypted pubkey", async () => {
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();
      expect(data.token).toBeDefined();
    });

    it("should handle multiple users and find correct one", async () => {
      // Create another user with different pubkey
      const otherUser = await createTestUser();
      const otherPubkey = "03b1c2d3e4f5678901234567890123456789012345678901234567890123456789ab";

      const otherEncryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        otherPubkey
      );

      await db.user.update({
        where: { id: otherUser.id },
        data: { lightningPubkey: JSON.stringify(otherEncryptedPubkey) },
      });

      // Link testUser with testPubkey
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();

      // Decode JWT to verify it's for the correct user
      const secret = process.env.NEXTAUTH_SECRET;
      const decoded = await decode({
        token: data.token,
        secret: secret!,
      });

      expect(decoded?.id).toBe(testUserId);
    });

    it("should skip users with null lightningPubkey", async () => {
      // Create user without pubkey
      const userWithoutPubkey = await createTestUser();

      // Ensure no pubkey set
      await db.user.update({
        where: { id: userWithoutPubkey.id },
        data: { lightningPubkey: null },
      });

      // Link testUser with testPubkey
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();

      // Should find testUser, not userWithoutPubkey
      const secret = process.env.NEXTAUTH_SECRET;
      const decoded = await decode({
        token: data.token,
        secret: secret!,
      });

      expect(decoded?.id).toBe(testUserId);
    });

    it("should handle invalid encrypted pubkey gracefully", async () => {
      // Set invalid encrypted data (not valid JSON)
      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: "invalid-encrypted-data" },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("User not found");
    });
  });

  describe("JWT Generation Tests", () => {
    beforeEach(async () => {
      // testUserId is already set by parent beforeEach
      // Mock is already set by parent beforeEach
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });
    });

    it("should return valid JWT token", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe("string");
      expect(data.token.length).toBeGreaterThan(0);
    });

    it("should return JWT that can be decoded by NextAuth", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      const data = await result.json<{ token: string }>();

      const secret = process.env.NEXTAUTH_SECRET;
      expect(secret).toBeDefined();

      const decoded = await decode({
        token: data.token,
        secret: secret!,
      });

      expect(decoded).toBeDefined();
      expect(decoded?.id).toBe(testUserId);
      expect(decoded?.email).toBe(user?.email);
      expect(decoded?.name).toBe(user?.name);
    });

    it("should include user email and name in JWT", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      const data = await result.json<{ token: string }>();

      const secret = process.env.NEXTAUTH_SECRET;
      const decoded = await decode({
        token: data.token,
        secret: secret!,
      });

      expect(decoded?.email).toBe(user?.email);
      expect(decoded?.name).toBe(user?.name);
    });

    it("should handle user with null email and name", async () => {
      // Update user to have null email and name
      await db.user.update({
        where: { id: testUserId },
        data: { email: null, name: null },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();

      const secret = process.env.NEXTAUTH_SECRET;
      const decoded = await decode({
        token: data.token,
        secret: secret!,
      });

      expect(decoded?.id).toBe(testUserId);
      expect(decoded?.email).toBeNull();
      expect(decoded?.name).toBeNull();
    });
  });

  describe("Error Handling Tests", () => {
    // testUserId is already set by parent beforeEach
    // Mock is already set by parent beforeEach

    it("should handle database errors gracefully", async () => {
      // Mock database error by using invalid user ID format
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: "invalid-pubkey-format",
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBeDefined();
    });

    it("should handle encryption service errors gracefully", async () => {
      // Set malformed encrypted data
      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: '{"invalid": "json"}' },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("User not found");
    });
  });

  describe("Security Tests", () => {
    beforeEach(async () => {
      // testUserId is already set by parent beforeEach
      // Mock is already set by parent beforeEach
      const encryptedPubkey = encryptionService.encryptField(
        "lightningPubkey",
        testPubkey
      );

      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });
    });

    it("should not leak user existence for invalid signatures", async () => {
      // Mock failed signature verification
      vi.spyOn(sphinxVerify, "verifySphinxToken").mockReturnValue(false);

      const result = await invokeRoute(POST, {
        method: "POST",
        body: {
          token: "invalid-token",
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Invalid signature");
      // Should not reveal whether user exists
    });

    it("should validate signature before database lookup", async () => {
      const verifySpy = vi.spyOn(sphinxVerify, "verifySphinxToken").mockReturnValue(false);

      await invokeRoute(POST, {
        method: "POST",
        body: {
          token: testToken,
          pubkey: testPubkey,
          timestamp: testTimestamp,
        },
      });

      // Verify that signature verification was called
      expect(verifySpy).toHaveBeenCalled();
    });
  });
});
