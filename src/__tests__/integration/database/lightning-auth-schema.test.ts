import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

const prisma = new PrismaClient();

describe("Lightning Authentication Database Schema", () => {
  let testUserId: string;
  let testChallengeId: string;

  beforeEach(async () => {
    // Clean up test data
    await prisma.sphinxChallenge.deleteMany({
      where: { k1: { startsWith: "test_" } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: "test_lightning_" } },
    });
  });

  describe("SphinxChallenge Model", () => {
    it("should create a SphinxChallenge record with all required fields", async () => {
      const k1 = "test_" + "a".repeat(60); // 64 chars total
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

      const challenge = await prisma.sphinxChallenge.create({
        data: {
          k1,
          expiresAt,
        },
      });

      expect(challenge.id).toBeDefined();
      expect(challenge.k1).toBe(k1);
      expect(challenge.pubkey).toBeNull();
      expect(challenge.used).toBe(false);
      expect(challenge.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -2);
      expect(challenge.createdAt).toBeDefined();

      testChallengeId = challenge.id;
    });

    it("should enforce unique constraint on k1", async () => {
      const k1 = "test_" + "b".repeat(60);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.sphinxChallenge.create({
        data: { k1, expiresAt },
      });

      // Attempt to create duplicate
      await expect(
        prisma.sphinxChallenge.create({
          data: { k1, expiresAt },
        })
      ).rejects.toThrow();
    });

    it("should update challenge with pubkey after verification", async () => {
      const k1 = "test_" + "c".repeat(60);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const lightningPubkey =
        "02" + "a".repeat(64); // 66-character hex pubkey

      const challenge = await prisma.sphinxChallenge.create({
        data: { k1, expiresAt },
      });

      const updated = await prisma.sphinxChallenge.update({
        where: { id: challenge.id },
        data: {
          pubkey: lightningPubkey,
          used: true,
        },
      });

      expect(updated.pubkey).toBe(lightningPubkey);
      expect(updated.used).toBe(true);
    });

    it("should find challenges by k1 index", async () => {
      const k1 = "test_" + "d".repeat(60);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.sphinxChallenge.create({
        data: { k1, expiresAt },
      });

      const found = await prisma.sphinxChallenge.findUnique({
        where: { k1 },
      });

      expect(found).toBeDefined();
      expect(found?.k1).toBe(k1);
    });

    it("should filter expired challenges using expiresAt index", async () => {
      const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const futureDate = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

      await prisma.sphinxChallenge.create({
        data: {
          k1: "test_" + "e".repeat(60),
          expiresAt: pastDate,
        },
      });

      await prisma.sphinxChallenge.create({
        data: {
          k1: "test_" + "f".repeat(60),
          expiresAt: futureDate,
        },
      });

      const validChallenges = await prisma.sphinxChallenge.findMany({
        where: {
          expiresAt: { gt: new Date() },
          k1: { startsWith: "test_" },
        },
      });

      expect(validChallenges).toHaveLength(1);
      expect(validChallenges[0].expiresAt.getTime()).toBeGreaterThan(
        Date.now()
      );
    });
  });

  describe("User Model with lightningPubkey", () => {
    it("should create a User with lightningPubkey field", async () => {
      const lightningPubkey =
        "02" + "b".repeat(64); // 66-character hex pubkey
      const encryptedPubkey = EncryptionService.getInstance().encryptField(
        lightningPubkey,
        "lightningPubkey"
      );

      const user = await prisma.user.create({
        data: {
          email: "test_lightning_user@example.com",
          name: "Lightning User",
          lightningPubkey: JSON.stringify(encryptedPubkey),
        },
      });

      expect(user.id).toBeDefined();
      expect(user.lightningPubkey).toBe(JSON.stringify(encryptedPubkey));

      testUserId = user.id;
    });

    it("should enforce unique constraint on lightningPubkey", async () => {
      const lightningPubkey =
        "02" + "c".repeat(64);
      const encryptedPubkey = EncryptionService.getInstance().encryptField(
        lightningPubkey,
        "lightningPubkey"
      );

      await prisma.user.create({
        data: {
          email: "test_lightning_user1@example.com",
          lightningPubkey: JSON.stringify(encryptedPubkey),
        },
      });

      // Attempt to create duplicate
      await expect(
        prisma.user.create({
          data: {
            email: "test_lightning_user2@example.com",
            lightningPubkey: JSON.stringify(encryptedPubkey),
          },
        })
      ).rejects.toThrow();
    });

    it("should allow null lightningPubkey for GitHub-only users", async () => {
      const user = await prisma.user.create({
        data: {
          email: "test_lightning_github_only@example.com",
          name: "GitHub Only User",
          lightningPubkey: null,
        },
      });

      expect(user.lightningPubkey).toBeNull();
    });

    it("should find user by encrypted lightningPubkey", async () => {
      const lightningPubkey =
        "02" + "d".repeat(64);
      const encryptedPubkey = EncryptionService.getInstance().encryptField(
        lightningPubkey,
        "lightningPubkey"
      );

      await prisma.user.create({
        data: {
          email: "test_lightning_findable@example.com",
          lightningPubkey: JSON.stringify(encryptedPubkey),
        },
      });

      const found = await prisma.user.findUnique({
        where: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      expect(found).toBeDefined();
      expect(found?.lightningPubkey).toBe(JSON.stringify(encryptedPubkey));
    });
  });

  describe("Lightning Authentication Integration", () => {
    it("should support full authentication flow", async () => {
      // Step 1: Create challenge
      const k1 = "test_" + "g".repeat(60);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const challenge = await prisma.sphinxChallenge.create({
        data: { k1, expiresAt },
      });

      expect(challenge.used).toBe(false);
      expect(challenge.pubkey).toBeNull();

      // Step 2: Verify and update challenge
      const lightningPubkey =
        "02" + "e".repeat(64);

      await prisma.sphinxChallenge.update({
        where: { id: challenge.id },
        data: {
          pubkey: lightningPubkey,
          used: true,
        },
      });

      // Step 3: Create or find user
      const encryptedPubkey = EncryptionService.getInstance().encryptField(
        lightningPubkey,
        "lightningPubkey"
      );

      const user = await prisma.user.create({
        data: {
          email: "test_lightning_flow@example.com",
          lightningPubkey: JSON.stringify(encryptedPubkey),
        },
      });

      // Step 4: Verify user can be found by pubkey
      const foundUser = await prisma.user.findUnique({
        where: { lightningPubkey: JSON.stringify(encryptedPubkey) },
      });

      expect(foundUser?.id).toBe(user.id);

      // Step 5: Verify challenge is marked as used
      const verifiedChallenge = await prisma.sphinxChallenge.findUnique({
        where: { k1 },
      });

      expect(verifiedChallenge?.used).toBe(true);
      expect(verifiedChallenge?.pubkey).toBe(lightningPubkey);
    });
  });
});
