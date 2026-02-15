import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  getKeyPrefix,
  timingSafeHashCompare,
} from "@/lib/api-keys";

describe("api-keys", () => {
  describe("generateApiKey", () => {
    it("should generate a key with correct format", () => {
      const workspaceId = "clxyz12345abcdef";
      const key = generateApiKey(workspaceId);

      // Should start with hive_ prefix
      expect(key.startsWith("hive_")).toBe(true);

      // Should include first 4 chars of workspace ID after hive_
      expect(key.startsWith(`hive_${workspaceId.slice(0, 4)}_`)).toBe(true);

      // Should have reasonable length (prefix + workspace prefix + _ + encoded bytes)
      // hive_ (5) + workspace prefix (4) + _ (1) + base62 encoded (32 chars) = 42
      expect(key.length).toBe(42);
    });

    it("should generate unique keys each time", () => {
      const workspaceId = "clxyz12345abcdef";
      const key1 = generateApiKey(workspaceId);
      const key2 = generateApiKey(workspaceId);

      expect(key1).not.toBe(key2);
    });

    it("should generate keys with valid base62 characters", () => {
      const workspaceId = "clxyz12345abcdef";
      const key = generateApiKey(workspaceId);

      // Remove the prefix (hive_xxxx_) and check the random part
      const randomPart = key.slice(10);
      const base62Regex = /^[0-9A-Za-z]+$/;

      expect(base62Regex.test(randomPart)).toBe(true);
    });

    it("should handle short workspace IDs", () => {
      const workspaceId = "ab";
      const key = generateApiKey(workspaceId);

      expect(key.startsWith("hive_ab_")).toBe(true);
    });

    it("should handle empty workspace ID", () => {
      const workspaceId = "";
      const key = generateApiKey(workspaceId);

      expect(key.startsWith("hive__")).toBe(true);
    });
  });

  describe("hashApiKey", () => {
    it("should produce consistent hashes for the same key", () => {
      const key = "hive_clxy_abcdefghijklmnopqrstuvwxyz12345";
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different keys", () => {
      const key1 = "hive_clxy_abcdefghijklmnopqrstuvwxyz12345";
      const key2 = "hive_clxy_abcdefghijklmnopqrstuvwxyz12346";
      const hash1 = hashApiKey(key1);
      const hash2 = hashApiKey(key2);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce a 64-character hex string (SHA-256)", () => {
      const key = "hive_clxy_abcdefghijklmnopqrstuvwxyz12345";
      const hash = hashApiKey(key);

      expect(hash.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });
  });

  describe("getKeyPrefix", () => {
    it("should return first 8 characters of key", () => {
      const key = "hive_clxy_abcdefghijklmnopqrstuvwxyz12345";
      const prefix = getKeyPrefix(key);

      expect(prefix).toBe("hive_clx");
      expect(prefix.length).toBe(8);
    });

    it("should handle short keys", () => {
      const key = "short";
      const prefix = getKeyPrefix(key);

      expect(prefix).toBe("short");
    });

    it("should handle empty key", () => {
      const key = "";
      const prefix = getKeyPrefix(key);

      expect(prefix).toBe("");
    });
  });

  describe("timingSafeHashCompare", () => {
    it("should return true for identical strings", () => {
      const hash = "a".repeat(64);
      expect(timingSafeHashCompare(hash, hash)).toBe(true);
    });

    it("should return false for different strings of same length", () => {
      const hash1 = "a".repeat(64);
      const hash2 = "b".repeat(64);
      expect(timingSafeHashCompare(hash1, hash2)).toBe(false);
    });

    it("should return false for strings of different lengths", () => {
      const hash1 = "a".repeat(64);
      const hash2 = "a".repeat(32);
      expect(timingSafeHashCompare(hash1, hash2)).toBe(false);
    });

    it("should return false for empty and non-empty strings", () => {
      const hash1 = "";
      const hash2 = "a".repeat(64);
      expect(timingSafeHashCompare(hash1, hash2)).toBe(false);
    });

    it("should return true for two empty strings", () => {
      expect(timingSafeHashCompare("", "")).toBe(true);
    });
  });

  describe("integration: key generation and hashing", () => {
    it("should be able to generate and hash a key", () => {
      const workspaceId = "clxyz12345abcdef";
      const key = generateApiKey(workspaceId);
      const hash = hashApiKey(key);
      const prefix = getKeyPrefix(key);

      // Verify key format
      expect(key.startsWith("hive_")).toBe(true);

      // Verify hash format
      expect(hash.length).toBe(64);

      // Verify prefix is subset of key
      expect(key.startsWith(prefix)).toBe(true);

      // Verify hash is deterministic
      expect(hashApiKey(key)).toBe(hash);
    });
  });
});
