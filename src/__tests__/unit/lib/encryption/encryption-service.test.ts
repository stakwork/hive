import { describe, it, expect, beforeEach } from "vitest";
import { EncryptionService, isEncrypted } from "@/lib/encryption";

describe("EncryptionService", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  });

  it("includes keyId in ciphertext and decrypts with registry", () => {
    const encSvc = EncryptionService.getInstance();
    const enc = encSvc.encryptField("swarmApiKey", "swarm-secret");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc.keyId).toBe("k-test");

    const plain = encSvc.decryptField("swarmApiKey", enc);
    expect(plain).toBe("swarm-secret");
  });

  it("encrypts with explicit key id and decrypts", () => {
    const encSvc = EncryptionService.getInstance();
    encSvc.setKey("k-alt", process.env.TOKEN_ENCRYPTION_KEY!);
    const enc = encSvc.encryptFieldWithKeyId(
      "poolApiKey",
      "pool-secret",
      "k-alt",
    );
    expect(enc.keyId).toBe("k-alt");
    const plain = encSvc.decryptField("poolApiKey", enc);
    expect(plain).toBe("pool-secret");
  });

  it("throws if key id missing in registry", () => {
    const encSvc = EncryptionService.getInstance();
    const ciphertext = encSvc.encryptFieldWithKeyId(
      "stakworkApiKey",
      "abc",
      "k-test",
    );
    // simulate ciphertext with unknown key id
    const tampered = { ...ciphertext, keyId: "unknown" } as typeof ciphertext;
    expect(() =>
      encSvc.decryptField("stakworkApiKey", tampered),
    ).toThrowError();
  });
});
