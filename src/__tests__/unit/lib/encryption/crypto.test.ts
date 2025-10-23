import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  isEncrypted,
  generateKey,
  hexToBuffer,
  bufferToHex,
} from "@/lib/encryption";
import crypto from "node:crypto";

describe("crypto primitives", () => {
  const keyBuf = hexToBuffer(
    process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  );

  it("roundtrips encryption/decryption", () => {
    const plaintexts = [
      "hello",
      "",
      "😀 unicode ✓",
      "long-" + "x".repeat(1024),
    ];

    for (const p of plaintexts) {
      const enc = encrypt(p, keyBuf, "k-test");
      expect(isEncrypted(enc)).toBe(true);
      const dec = decrypt(enc, keyBuf);
      expect(dec).toBe(p);
    }
  });

  it("fails decryption with wrong key", () => {
    const enc = encrypt("secret", keyBuf, "k-test");
    const wrongKey = generateKey();
    expect(() => decrypt(enc, wrongKey)).toThrowError();
  });

  it("detects tampering (auth tag)", () => {
    const enc = encrypt("secret", keyBuf, "k-test");
    const tampered = { ...enc, tag: enc.tag.slice(0, -2) + "AA" };
    expect(() => decrypt(tampered, keyBuf)).toThrowError();
  });

  it("exposes version and keyId", () => {
    const enc = encrypt("secret", keyBuf, "k-test");
    expect(enc.version).toBe("1");
    expect(enc.keyId).toBe("k-test");
    expect(typeof enc.iv).toBe("string");
    expect(typeof enc.tag).toBe("string");
    expect(typeof enc.data).toBe("string");
  });
});

describe("bufferToHex", () => {
  it("converts buffer to lowercase hex string", () => {
    const buffer = Buffer.from("hello");
    const hex = bufferToHex(buffer);
    expect(hex).toBe("68656c6c6f");
    expect(hex).toMatch(/^[a-f0-9]+$/);
  });

  it("handles empty buffer", () => {
    const buffer = Buffer.alloc(0);
    const hex = bufferToHex(buffer);
    expect(hex).toBe("");
    expect(hex).toMatch(/^[a-f0-9]*$/);
  });

  it("converts buffers of various sizes", () => {
    const sizes = [1, 16, 32, 64, 256, 1024];
    for (const size of sizes) {
      const buffer = crypto.randomBytes(size);
      const hex = bufferToHex(buffer);
      expect(hex.length).toBe(size * 2);
      expect(hex).toMatch(/^[a-f0-9]+$/);
    }
  });

  it("roundtrips with hexToBuffer", () => {
    const testData = [
      "hello",
      "test data",
      "😀 unicode ✓",
      "special !@#$%^&*()",
      "x".repeat(1024),
    ];

    for (const data of testData) {
      const buffer = Buffer.from(data, "utf8");
      const hex = bufferToHex(buffer);
      const roundtrip = hexToBuffer(hex);
      expect(roundtrip.toString("utf8")).toBe(data);
      expect(Buffer.compare(buffer, roundtrip)).toBe(0);
    }
  });

  it("produces consistent output for same input", () => {
    const buffer = Buffer.from("consistent test");
    const hex1 = bufferToHex(buffer);
    const hex2 = bufferToHex(buffer);
    expect(hex1).toBe(hex2);
  });

  it("handles unicode data correctly", () => {
    const unicodeStrings = [
      "Hello 世界",
      "🌍 émojis ✨",
      "Ω ≈ π",
      "مرحبا",
    ];

    for (const str of unicodeStrings) {
      const buffer = Buffer.from(str, "utf8");
      const hex = bufferToHex(buffer);
      expect(hex).toMatch(/^[a-f0-9]+$/);
      const decoded = Buffer.from(hex, "hex").toString("utf8");
      expect(decoded).toBe(str);
    }
  });

  it("produces valid hex format output", () => {
    const buffer = crypto.randomBytes(32);
    const hex = bufferToHex(buffer);
    
    expect(typeof hex).toBe("string");
    expect(hex.length).toBe(64);
    expect(hex).toMatch(/^[a-f0-9]+$/);
    expect(hex).toBe(hex.toLowerCase());
    expect(hex).not.toMatch(/[A-F]/);
  });

  it("handles cryptographic key buffers", () => {
    const keyBuf = hexToBuffer(
      process.env.TOKEN_ENCRYPTION_KEY ||
        "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    );
    const hex = bufferToHex(keyBuf);
    
    expect(hex.length).toBe(64);
    expect(hex).toMatch(/^[a-f0-9]+$/);
    const reconstructed = hexToBuffer(hex);
    expect(Buffer.compare(keyBuf, reconstructed)).toBe(0);
  });
});
