import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  isEncrypted,
  generateKey,
  hexToBuffer,
} from "@/lib/encryption";

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
