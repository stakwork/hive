import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  isEncrypted,
  generateKey,
  hexToBuffer,
  bufferToHex,
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

describe("bufferToHex", () => {
  it("converts buffer to hex string with known values", () => {
    const testCases = [
      { input: Buffer.from("hello"), expected: "68656c6c6f" },
      { input: Buffer.from("world"), expected: "776f726c64" },
      { input: Buffer.from([0, 1, 255]), expected: "0001ff" },
      { input: Buffer.from([15, 16, 17]), expected: "0f1011" },
    ];

    for (const { input, expected } of testCases) {
      expect(bufferToHex(input)).toBe(expected);
    }
  });

  it("produces valid hex format", () => {
    const buffers = [
      Buffer.from("test"),
      Buffer.from("😀 unicode ✓"),
      Buffer.from("x".repeat(1024)),
      Buffer.from([0, 15, 255, 170, 204]),
    ];

    for (const buf of buffers) {
      const hex = bufferToHex(buf);
      expect(hex).toMatch(/^[a-f0-9]*$/);
      expect(hex.length).toBe(buf.length * 2);
    }
  });

  it("handles empty buffer", () => {
    const empty = Buffer.from("");
    const hex = bufferToHex(empty);
    expect(hex).toBe("");
  });

  it("roundtrips with hexToBuffer", () => {
    const testStrings = [
      "hello",
      "",
      "😀 unicode ✓",
      "long-" + "x".repeat(1024),
      "special chars: \n\t\r",
    ];

    for (const str of testStrings) {
      const buf = Buffer.from(str);
      const hex = bufferToHex(buf);
      const restored = hexToBuffer(hex);
      expect(restored).toEqual(buf);
      expect(restored.toString()).toBe(str);
    }
  });

  it("handles unicode characters correctly", () => {
    const unicodeBuf = Buffer.from("😀🎉✓");
    const hex = bufferToHex(unicodeBuf);
    expect(hex).toMatch(/^[a-f0-9]+$/);
    expect(hexToBuffer(hex)).toEqual(unicodeBuf);
    expect(hexToBuffer(hex).toString()).toBe("😀🎉✓");
  });

  it("handles large buffers", () => {
    const largeBuf = Buffer.from("x".repeat(10000));
    const hex = bufferToHex(largeBuf);
    expect(hex.length).toBe(largeBuf.length * 2);
    expect(hex).toMatch(/^[a-f0-9]+$/);
    expect(hexToBuffer(hex)).toEqual(largeBuf);
  });

  it("produces lowercase hexadecimal", () => {
    const buf = Buffer.from([255, 170, 204]);
    const hex = bufferToHex(buf);
    expect(hex).toBe("ffaacc");
    expect(hex).not.toMatch(/[A-F]/);
  });

  it("handles all byte values 0-255", () => {
    const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const hex = bufferToHex(allBytes);
    expect(hex.length).toBe(512);
    expect(hex).toMatch(/^[a-f0-9]+$/);
    expect(hexToBuffer(hex)).toEqual(allBytes);
  });

  it("is consistent for same input", () => {
    const buf = Buffer.from("consistency test");
    const hex1 = bufferToHex(buf);
    const hex2 = bufferToHex(buf);
    expect(hex1).toBe(hex2);
  });
});
