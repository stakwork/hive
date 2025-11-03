import { describe, it, expect, beforeEach } from "vitest";
import { ApiKeyService } from "@/services/api-key/ApiKeyService";
import crypto from "crypto";

describe("ApiKeyService", () => {
  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService();
  });

  describe("generateKey", () => {
    it("should generate keys with correct prefix", () => {
      const key = service.generateKey();
      expect(key).toMatch(/^hive_[a-f0-9]{64}$/);
    });

    it("should generate unique keys", () => {
      const key1 = service.generateKey();
      const key2 = service.generateKey();
      expect(key1).not.toBe(key2);
    });

    it("should generate keys of consistent length", () => {
      const keys = Array.from({ length: 10 }, () => service.generateKey());
      const lengths = keys.map((k) => k.length);
      expect(new Set(lengths).size).toBe(1);
    });
  });

  describe("hashKey", () => {
    it("should create SHA256 hash of key", () => {
      const key = "hive_test123";
      const hash = service.hashKey(key);
      
      // Verify it's a valid hex string
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      
      // Verify it matches expected SHA256 output
      const expected = crypto
        .createHash("sha256")
        .update(key)
        .digest("hex");
      expect(hash).toBe(expected);
    });

    it("should produce consistent hashes", () => {
      const key = "hive_test123";
      const hash1 = service.hashKey(key);
      const hash2 = service.hashKey(key);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different keys", () => {
      const key1 = "hive_test123";
      const key2 = "hive_test456";
      const hash1 = service.hashKey(key1);
      const hash2 = service.hashKey(key2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("key format validation", () => {
    it("should validate hive_ prefix", () => {
      const key = service.generateKey();
      expect(key.startsWith("hive_")).toBe(true);
    });

    it("should contain only hex characters after prefix", () => {
      const key = service.generateKey();
      const hexPart = key.replace("hive_", "");
      expect(hexPart).toMatch(/^[a-f0-9]+$/);
    });

    it("should have 64 hex characters after prefix (32 bytes)", () => {
      const key = service.generateKey();
      const hexPart = key.replace("hive_", "");
      expect(hexPart.length).toBe(64);
    });
  });

  describe("security properties", () => {
    it("should generate cryptographically random keys", () => {
      const keys = new Set(
        Array.from({ length: 100 }, () => service.generateKey()),
      );
      // All keys should be unique
      expect(keys.size).toBe(100);
    });

    it("should not reveal key from hash", () => {
      const key = service.generateKey();
      const hash = service.hashKey(key);
      
      // Hash should not contain any part of the original key
      expect(hash).not.toContain(key);
      expect(hash).not.toContain(key.replace("hive_", ""));
    });

    it("should use collision-resistant hash function", () => {
      const keys = Array.from({ length: 1000 }, () => service.generateKey());
      const hashes = keys.map((k) => service.hashKey(k));
      const uniqueHashes = new Set(hashes);
      
      // No hash collisions
      expect(uniqueHashes.size).toBe(1000);
    });
  });
});