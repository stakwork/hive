import { describe, it, expect, beforeEach } from "vitest";
import { EncryptionService } from "@/lib/encryption";

describe("Voice Embedding Encryption", () => {
  const mockEmbedding = Array.from({ length: 128 }, (_, i) => i * 0.01);
  const embeddingString = JSON.stringify(mockEmbedding);
  let encryptionService: ReturnType<typeof EncryptionService.getInstance>;

  beforeEach(() => {
    // Ensure encryption service is initialized
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    }
    if (!process.env.TOKEN_ENCRYPTION_KEY_ID) {
      process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key-1";
    }
    encryptionService = EncryptionService.getInstance();
  });

  it("should encrypt voice embedding successfully", () => {
    const encrypted = encryptionService.encryptField(
      "voiceEmbedding",
      embeddingString
    );

    expect(encrypted).toBeDefined();
    expect(typeof encrypted).toBe("object");
    expect(encrypted).toHaveProperty("data");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("tag");
    expect(JSON.stringify(encrypted)).not.toBe(embeddingString);
  });

  it("should decrypt voice embedding to original value", () => {
    const encrypted = encryptionService.encryptField(
      "voiceEmbedding",
      embeddingString
    );

    const decrypted = encryptionService.decryptField(
      "voiceEmbedding",
      JSON.stringify(encrypted)
    );

    expect(decrypted).toBe(embeddingString);
    const parsedDecrypted = JSON.parse(decrypted);
    expect(parsedDecrypted).toEqual(mockEmbedding);
  });

  it("should handle large embedding vectors", () => {
    const largeEmbedding = Array.from({ length: 512 }, (_, i) => Math.random());
    const largeEmbeddingString = JSON.stringify(largeEmbedding);

    const encrypted = encryptionService.encryptField(
      "voiceEmbedding",
      largeEmbeddingString
    );

    const decrypted = encryptionService.decryptField(
      "voiceEmbedding",
      JSON.stringify(encrypted)
    );

    expect(JSON.parse(decrypted)).toEqual(largeEmbedding);
  });

  it("should handle invalid encrypted data by returning plaintext", () => {
    const result = encryptionService.decryptField("voiceEmbedding", "invalid-encrypted-data");
    // The encryption service returns the original string if it can't decrypt it
    expect(result).toBe("invalid-encrypted-data");
  });

  it("should maintain precision of floating point values", () => {
    const precisionEmbedding = [
      0.123456789,
      -0.987654321,
      0.0,
      1.0,
      -1.0,
    ];
    const precisionString = JSON.stringify(precisionEmbedding);

    const encrypted = encryptionService.encryptField(
      "voiceEmbedding",
      precisionString
    );

    const decrypted = encryptionService.decryptField(
      "voiceEmbedding",
      JSON.stringify(encrypted)
    );

    expect(JSON.parse(decrypted)).toEqual(precisionEmbedding);
  });

  it("should produce different encrypted values for same input", () => {
    const encrypted1 = encryptionService.encryptField(
      "voiceEmbedding",
      embeddingString
    );

    const encrypted2 = encryptionService.encryptField(
      "voiceEmbedding",
      embeddingString
    );

    // Different IVs should produce different ciphertexts
    expect(JSON.stringify(encrypted1)).not.toBe(JSON.stringify(encrypted2));

    // But both should decrypt to the same value
    const decrypted1 = encryptionService.decryptField(
      "voiceEmbedding",
      JSON.stringify(encrypted1)
    );
    const decrypted2 = encryptionService.decryptField(
      "voiceEmbedding",
      JSON.stringify(encrypted2)
    );

    expect(decrypted1).toBe(decrypted2);
    expect(decrypted1).toBe(embeddingString);
  });
});
