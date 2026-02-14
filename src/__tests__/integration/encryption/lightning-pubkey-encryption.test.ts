import { describe, it, expect, beforeEach } from "vitest";
import { EncryptionService, isEncrypted } from "@/lib/encryption";

describe("Lightning Pubkey Encryption", () => {
  const testPubkeys = [
    "02" + "a".repeat(64), // Compressed pubkey starting with 02
    "03" + "b".repeat(64), // Compressed pubkey starting with 03
    "04" + "c".repeat(128), // Uncompressed pubkey starting with 04
  ];

  describe("encryptField", () => {
    it("should encrypt lightningPubkey field", () => {
      const pubkey = testPubkeys[0];
      const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(pubkey);
      expect(typeof encrypted).toBe("object");
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it("should produce different ciphertext for same pubkey on multiple encryptions", () => {
      const pubkey = testPubkeys[1];
      const encrypted1 = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      const encrypted2 = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);

      // Different due to random IV
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should encrypt different length pubkeys", () => {
      testPubkeys.forEach((pubkey) => {
        const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
        expect(isEncrypted(encrypted)).toBe(true);
      });
    });
  });

  describe("decryptField", () => {
    it("should decrypt lightningPubkey field back to original value", () => {
      const pubkey = testPubkeys[0];
      const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      const decrypted = EncryptionService.getInstance().decryptField("lightningPubkey", encrypted);

      expect(decrypted).toBe(pubkey);
    });

    it("should decrypt all pubkey formats correctly", () => {
      testPubkeys.forEach((pubkey) => {
        const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
        const decrypted = EncryptionService.getInstance().decryptField("lightningPubkey", encrypted);
        expect(decrypted).toBe(pubkey);
      });
    });

    it("should handle plaintext pubkey gracefully during migration", () => {
      // During migration phase, some pubkeys may still be plaintext
      const pubkey = testPubkeys[0];
      const decrypted = EncryptionService.getInstance().decryptField("lightningPubkey", pubkey);

      // Should return plaintext as-is if not encrypted
      expect(decrypted).toBe(pubkey);
    });

    it("should handle invalid encrypted data gracefully", () => {
      const invalidData = "not-valid-encrypted-data";
      
      // Should return plaintext as-is if not valid encrypted data
      const decrypted = EncryptionService.getInstance().decryptField("lightningPubkey", invalidData);
      expect(decrypted).toBe(invalidData);
    });
  });

  describe("Round-trip encryption", () => {
    it("should maintain data integrity through encrypt-decrypt cycle", () => {
      testPubkeys.forEach((pubkey) => {
        const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
        const decrypted = EncryptionService.getInstance().decryptField("lightningPubkey", encrypted);
        
        expect(decrypted).toBe(pubkey);
        expect(decrypted.length).toBe(pubkey.length);
      });
    });

    it("should handle multiple encrypt-decrypt cycles", () => {
      const pubkey = testPubkeys[0];
      
      for (let i = 0; i < 5; i++) {
        const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
        const decrypted = EncryptionService.getInstance().decryptField("lightningPubkey", encrypted);
        expect(decrypted).toBe(pubkey);
      }
    });
  });

  describe("Encrypted data format", () => {
    it("should contain required encrypted data fields", () => {
      const pubkey = testPubkeys[0];
      const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      
      // Parse the encrypted JSON
      const parsed = encrypted;
      
      expect(parsed).toHaveProperty("data");
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("tag");
      expect(parsed).toHaveProperty("keyId");
      expect(parsed).toHaveProperty("version");
      expect(parsed).toHaveProperty("encryptedAt");
    });

    it("should use correct encryption version", () => {
      const pubkey = testPubkeys[0];
      const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      const parsed = encrypted;
      
      expect(parsed.version).toBe("1");
    });

    it("should include valid keyId", () => {
      const pubkey = testPubkeys[0];
      const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      const parsed = encrypted;
      
      expect(parsed.keyId).toBeDefined();
      expect(typeof parsed.keyId).toBe("string");
    });
  });

  describe("Security properties", () => {
    it("should not contain plaintext pubkey in encrypted output", () => {
      testPubkeys.forEach((pubkey) => {
        const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
        
        // Encrypted data should not contain the plaintext
        const encryptedStr = JSON.stringify(encrypted).toLowerCase();
        expect(encryptedStr).not.toContain(pubkey.toLowerCase());
      });
    });

    it("should use unique IV for each encryption", () => {
      const pubkey = testPubkeys[0];
      const encrypted1 = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      const encrypted2 = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      
      const parsed1 = encrypted1;
      const parsed2 = encrypted2;
      
      expect(parsed1.iv).not.toBe(parsed2.iv);
    });

    it("should include authentication tag for integrity", () => {
      const pubkey = testPubkeys[0];
      const encrypted = EncryptionService.getInstance().encryptField("lightningPubkey", pubkey);
      const parsed = encrypted;
      
      expect(parsed.tag).toBeDefined();
      expect(parsed.tag.length).toBeGreaterThan(0);
    });
  });
});
