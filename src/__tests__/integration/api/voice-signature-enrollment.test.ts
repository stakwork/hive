import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

describe("Voice Signature Enrollment Integration", () => {
  let testUserId: string;
  let encryptionService: ReturnType<typeof EncryptionService.getInstance>;

  beforeAll(async () => {
    // Ensure encryption keys are set
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    }
    if (!process.env.TOKEN_ENCRYPTION_KEY_ID) {
      process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key-1";
    }
    encryptionService = EncryptionService.getInstance();
  });

  beforeEach(async () => {
    // Create a test user
    const testUser = await db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: "Test User",
      },
    });
    testUserId = testUser.id;
  });

  afterAll(async () => {
    // Cleanup: Delete all test voice signatures and users
    await db.voiceSignature.deleteMany({
      where: {
        userId: testUserId,
      },
    });
    await db.user.deleteMany({
      where: {
        id: testUserId,
      },
    });
  });

  it("should create new voice signature with encrypted embedding", async () => {
    const mockEmbedding = Array.from({ length: 128 }, () => Math.random());
    const embeddingString = JSON.stringify(mockEmbedding);

    // Encrypt the embedding
    const encryptedEmbedding = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", embeddingString)
    );

    // Create voice signature in database
    const voiceSignature = await db.voiceSignature.create({
      data: {
        userId: testUserId,
        voiceEmbedding: encryptedEmbedding,
        sampleCount: 1,
      },
    });

    expect(voiceSignature).toBeDefined();
    expect(voiceSignature.userId).toBe(testUserId);
    expect(voiceSignature.sampleCount).toBe(1);
    expect(voiceSignature.voiceEmbedding).not.toBe(embeddingString);

    // Verify encryption by decrypting
    const decrypted = encryptionService.decryptField(
      "voiceEmbedding",
      voiceSignature.voiceEmbedding
    );
    expect(JSON.parse(decrypted)).toEqual(mockEmbedding);
  });

  it("should update existing voice signature with upsert", async () => {
    const embedding1 = Array.from({ length: 128 }, () => Math.random());
    const encrypted1 = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", JSON.stringify(embedding1))
    );

    // Create initial voice signature
    const initial = await db.voiceSignature.create({
      data: {
        userId: testUserId,
        voiceEmbedding: encrypted1,
        sampleCount: 1,
      },
    });

    // Upsert with new embedding
    const embedding2 = Array.from({ length: 128 }, () => Math.random());
    const encrypted2 = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", JSON.stringify(embedding2))
    );

    const updated = await db.voiceSignature.upsert({
      where: { userId: testUserId },
      update: {
        voiceEmbedding: encrypted2,
        sampleCount: { increment: 1 },
      },
      create: {
        userId: testUserId,
        voiceEmbedding: encrypted2,
        sampleCount: 1,
      },
    });

    expect(updated.id).toBe(initial.id);
    expect(updated.sampleCount).toBe(2);
    expect(updated.voiceEmbedding).toBe(encrypted2);

    // Verify the updated embedding
    const decrypted = encryptionService.decryptField(
      "voiceEmbedding",
      updated.voiceEmbedding
    );
    expect(JSON.parse(decrypted)).toEqual(embedding2);
  });

  it("should fetch voice signature metadata without embedding", async () => {
    const embedding = Array.from({ length: 128 }, () => Math.random());
    const encrypted = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", JSON.stringify(embedding))
    );

    await db.voiceSignature.create({
      data: {
        userId: testUserId,
        voiceEmbedding: encrypted,
        sampleCount: 3,
      },
    });

    // Fetch without embedding field
    const metadata = await db.voiceSignature.findUnique({
      where: { userId: testUserId },
      select: {
        id: true,
        sampleCount: true,
        lastUpdatedAt: true,
        createdAt: true,
      },
    });

    expect(metadata).toBeDefined();
    expect(metadata?.sampleCount).toBe(3);
    expect((metadata as any).voiceEmbedding).toBeUndefined();
  });

  it("should delete voice signature", async () => {
    const embedding = Array.from({ length: 128 }, () => Math.random());
    const encrypted = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", JSON.stringify(embedding))
    );

    await db.voiceSignature.create({
      data: {
        userId: testUserId,
        voiceEmbedding: encrypted,
        sampleCount: 1,
      },
    });

    // Delete voice signature
    await db.voiceSignature.delete({
      where: { userId: testUserId },
    });

    // Verify deletion
    const deleted = await db.voiceSignature.findUnique({
      where: { userId: testUserId },
    });

    expect(deleted).toBeNull();
  });

  it("should enforce unique constraint on userId", async () => {
    const embedding = Array.from({ length: 128 }, () => Math.random());
    const encrypted = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", JSON.stringify(embedding))
    );

    await db.voiceSignature.create({
      data: {
        userId: testUserId,
        voiceEmbedding: encrypted,
        sampleCount: 1,
      },
    });

    // Attempt to create duplicate should fail
    await expect(
      db.voiceSignature.create({
        data: {
          userId: testUserId,
          voiceEmbedding: encrypted,
          sampleCount: 1,
        },
      })
    ).rejects.toThrow();
  });

  it("should cascade delete voice signature when user is deleted", async () => {
    const embedding = Array.from({ length: 128 }, () => Math.random());
    const encrypted = JSON.stringify(
      encryptionService.encryptField("voiceEmbedding", JSON.stringify(embedding))
    );

    await db.voiceSignature.create({
      data: {
        userId: testUserId,
        voiceEmbedding: encrypted,
        sampleCount: 1,
      },
    });

    // Delete user
    await db.user.delete({
      where: { id: testUserId },
    });

    // Verify voice signature was also deleted
    const voiceSignature = await db.voiceSignature.findUnique({
      where: { userId: testUserId },
    });

    expect(voiceSignature).toBeNull();
  });
});
