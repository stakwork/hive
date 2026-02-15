import { describe, it, expect, beforeEach } from "vitest";
import { DELETE } from "@/app/api/auth/sphinx/unlink/route";
import { db } from "@/lib/db";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

describe("DELETE /api/auth/sphinx/unlink Integration Tests", () => {
  const testPubkey = "02a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890";
  let testUserId: string;

  beforeEach(async () => {
    // Clean up any existing test data
    await db.account.deleteMany({ where: { provider: "sphinx" } });
  });

  describe("Authentication Tests", () => {
    it("should return 401 when user not authenticated", async () => {
      const result = await invokeRoute(DELETE, {
        method: "DELETE",
        session: null,
      });

      expect(result.status).toBe(401);
      const data = await result.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user id", async () => {
      const result = await invokeRoute(DELETE, {
        method: "DELETE",
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

  describe("Successful Unlink Tests", () => {
    beforeEach(async () => {
      const user = await createTestUser();
      testUserId = user.id;

      // Set up a linked Sphinx account
      const encrypted = encryptionService.encryptField("lightningPubkey", testPubkey);
      const encryptedPubkey = JSON.stringify(encrypted);
      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: encryptedPubkey },
      });

      await db.account.create({
        data: {
          userId: testUserId,
          type: "oauth",
          provider: "sphinx",
          providerAccountId: testPubkey,
        },
      });
    });

    it("should successfully unlink Sphinx account", async () => {
      const result = await invokeRoute(DELETE, {
        method: "DELETE",
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json();
      expect(data.success).toBe(true);

      // Verify lightningPubkey was cleared
      const updatedUser = await db.user.findUnique({
        where: { id: testUserId },
      });
      expect(updatedUser?.lightningPubkey).toBeNull();

      // Verify Sphinx account was deleted
      const sphinxAccount = await db.account.findFirst({
        where: {
          userId: testUserId,
          provider: "sphinx",
        },
      });
      expect(sphinxAccount).toBeNull();
    });

    it("should work even if no Sphinx account exists", async () => {
      // Delete the Sphinx account first
      await db.account.deleteMany({
        where: {
          userId: testUserId,
          provider: "sphinx",
        },
      });

      const result = await invokeRoute(DELETE, {
        method: "DELETE",
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(200);
      const data = await result.json();
      expect(data.success).toBe(true);

      // Verify lightningPubkey was still cleared
      const updatedUser = await db.user.findUnique({
        where: { id: testUserId },
      });
      expect(updatedUser?.lightningPubkey).toBeNull();
    });

    it("should only delete Sphinx accounts, not other providers", async () => {
      // Create a GitHub account for the same user
      await db.account.create({
        data: {
          userId: testUserId,
          type: "oauth",
          provider: "github",
          providerAccountId: "github123",
        },
      });

      const result = await invokeRoute(DELETE, {
        method: "DELETE",
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(result.status).toBe(200);

      // Verify Sphinx account was deleted
      const sphinxAccount = await db.account.findFirst({
        where: {
          userId: testUserId,
          provider: "sphinx",
        },
      });
      expect(sphinxAccount).toBeNull();

      // Verify GitHub account still exists
      const githubAccount = await db.account.findFirst({
        where: {
          userId: testUserId,
          provider: "github",
        },
      });
      expect(githubAccount).not.toBeNull();
    });
  });

  describe("Transaction Consistency Tests", () => {
    beforeEach(async () => {
      const user = await createTestUser();
      testUserId = user.id;

      // Set up a linked Sphinx account
      const encrypted = encryptionService.encryptField("lightningPubkey", testPubkey);
      const encryptedPubkey = JSON.stringify(encrypted);
      await db.user.update({
        where: { id: testUserId },
        data: { lightningPubkey: encryptedPubkey },
      });

      await db.account.create({
        data: {
          userId: testUserId,
          type: "oauth",
          provider: "sphinx",
          providerAccountId: testPubkey,
        },
      });
    });

    it("should handle multiple unlink requests idempotently", async () => {
      // First unlink
      const result1 = await invokeRoute(DELETE, {
        method: "DELETE",
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(result1.status).toBe(200);

      // Second unlink (should still succeed)
      const result2 = await invokeRoute(DELETE, {
        method: "DELETE",
        session: {
          user: { id: testUserId },
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(result2.status).toBe(200);

      // Verify state is consistent
      const user = await db.user.findUnique({
        where: { id: testUserId },
      });
      expect(user?.lightningPubkey).toBeNull();

      const sphinxAccount = await db.account.findFirst({
        where: {
          userId: testUserId,
          provider: "sphinx",
        },
      });
      expect(sphinxAccount).toBeNull();
    });
  });
});
