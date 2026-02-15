import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/sphinx/link/route";
import { db } from "@/lib/db";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { EncryptionService } from "@/lib/encryption";
import { decode } from "next-auth/jwt";

const encryptionService = EncryptionService.getInstance();

describe("POST /api/auth/sphinx/link Integration Tests", () => {
  const testPubkey = "02a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890";
  let testUserId: string;
  let testChallenge: string;

  beforeEach(async () => {
    // Clean up any existing test data
    await db.sphinxChallenge.deleteMany({});
    await db.account.deleteMany({ where: { provider: "sphinx" } });
  });

  describe("Authentication Tests", () => {
    it("should return 401 when user not authenticated", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: "test-challenge" },
        session: null,
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user id", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: "test-challenge" },
        session: {
          user: { email: "test@example.com" },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Challenge Validation Tests", () => {
    beforeEach(async () => {
      const user = await createTestUser();
      testUserId = user.id;
    });

    it("should return 400 when challenge parameter is missing", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: {},
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Challenge is required");
    });

    it("should return 404 when challenge does not exist", async () => {
      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: "nonexistent-challenge" },
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(404);
      const data = await result.json();
      expect(data.error).toBe("Challenge not found");
    });

    it("should return 400 when challenge is not verified (used=false)", async () => {
      const challenge = await db.sphinxChallenge.create({
        data: {
          k1: "test-challenge-unverified",
          used: false,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: challenge.k1 },
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Challenge not verified");

      // Cleanup
      await db.sphinxChallenge.delete({ where: { id: challenge.id } });
    });

    it("should return 400 when challenge has no pubkey", async () => {
      const challenge = await db.sphinxChallenge.create({
        data: {
          k1: "test-challenge-no-pubkey",
          used: true,
          pubkey: null,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: challenge.k1 },
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Challenge not verified");

      // Cleanup
      await db.sphinxChallenge.delete({ where: { id: challenge.id } });
    });

    it("should return 400 when challenge has expired", async () => {
      const challenge = await db.sphinxChallenge.create({
        data: {
          k1: "test-challenge-expired",
          used: true,
          pubkey: testPubkey,
          expiresAt: new Date(Date.now() - 1000), // Expired
        },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: challenge.k1 },
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBe("Challenge expired");

      // Note: Route already deletes expired challenges, no cleanup needed
    });
  });

  describe("Successful Linking Tests", () => {
    beforeEach(async () => {
      const user = await createTestUser();
      testUserId = user.id;

      const challenge = await db.sphinxChallenge.create({
        data: {
          k1: "test-challenge-valid",
          used: true,
          pubkey: testPubkey,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      testChallenge = challenge.k1;
    });

    it("should successfully link pubkey to user and return JWT", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: testChallenge },
        session: {
          user: { id: testUserId, email: user?.email, name: user?.name },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json<{ token: string }>();
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe("string");
      expect(data.token.length).toBeGreaterThan(0);
    });

    it("should encrypt and store pubkey in user record", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      await invokeRoute(POST, {
        method: "POST",
        body: { challenge: testChallenge },
        session: {
          user: { id: testUserId, email: user?.email, name: user?.name },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const updatedUser = await db.user.findUnique({
        where: { id: testUserId },
      });

      expect(updatedUser?.lightningPubkey).toBeDefined();
      expect(updatedUser?.lightningPubkey).not.toBe(testPubkey); // Should be encrypted

      // Verify decryption works
      const encryptedData = JSON.parse(updatedUser?.lightningPubkey as string);
      const decrypted = encryptionService.decryptField(
        "lightningPubkey",
        encryptedData
      );
      expect(decrypted).toBe(testPubkey);
    });

    it("should create Account record with provider sphinx", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      await invokeRoute(POST, {
        method: "POST",
        body: { challenge: testChallenge },
        session: {
          user: { id: testUserId, email: user?.email, name: user?.name },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const account = await db.account.findFirst({
        where: {
          userId: testUserId,
          provider: "sphinx",
        },
      });

      expect(account).toBeDefined();
      expect(account?.type).toBe("oauth");
      expect(account?.provider).toBe("sphinx");
      expect(account?.providerAccountId).toBe(testPubkey);
    });

    it("should return valid JWT that can be decoded", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: testChallenge },
        session: {
          user: { id: testUserId, email: user?.email, name: user?.name },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const data = await result.json<{ token: string }>();

      // Decode the JWT
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

    it("should delete used challenge after successful linking", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      await invokeRoute(POST, {
        method: "POST",
        body: { challenge: testChallenge },
        session: {
          user: { id: testUserId, email: user?.email, name: user?.name },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const challenge = await db.sphinxChallenge.findUnique({
        where: { k1: testChallenge },
      });

      expect(challenge).toBeNull();
    });

    it("should update existing account if already linked", async () => {
      const user = await db.user.findUnique({ where: { id: testUserId } });

      // Create initial account
      await db.account.create({
        data: {
          userId: testUserId,
          type: "oauth",
          provider: "sphinx",
          providerAccountId: "old-pubkey",
        },
      });

      await invokeRoute(POST, {
        method: "POST",
        body: { challenge: testChallenge },
        session: {
          user: { id: testUserId, email: user?.email, name: user?.name },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      const accounts = await db.account.findMany({
        where: {
          userId: testUserId,
          provider: "sphinx",
        },
      });

      // Should only have one account, updated with new pubkey
      expect(accounts.length).toBe(1);
      expect(accounts[0].providerAccountId).toBe(testPubkey);
    });
  });

  describe("Error Handling Tests", () => {
    beforeEach(async () => {
      const user = await createTestUser();
      testUserId = user.id;
    });

    it("should handle database errors gracefully", async () => {
      // Create challenge with invalid k1 to trigger error
      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: "" },
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(400);
      const data = await result.json();
      expect(data.error).toBeDefined();
    });

    it("should handle user not found error", async () => {
      const challenge = await db.sphinxChallenge.create({
        data: {
          k1: "test-challenge-no-user",
          used: true,
          pubkey: testPubkey,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      const result = await invokeRoute(POST, {
        method: "POST",
        body: { challenge: challenge.k1 },
        session: {
          user: { id: "nonexistent-user-id" },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(500);
      const data = await result.json();
      expect(data.error).toBeDefined();

      // Cleanup
      await db.sphinxChallenge.delete({ where: { id: challenge.id } });
    });
  });
});
