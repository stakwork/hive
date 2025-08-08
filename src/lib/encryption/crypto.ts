import crypto from "node:crypto";
import {
  EncryptedData,
  EncryptionConfig,
  EncryptionError,
} from "@/types/encryption";

const CONFIG: EncryptionConfig = {
  algorithm: "aes-256-gcm",
  keyLength: 32,
  ivLength: 16,
  tagLength: 16,
};

const VERSION = "1";

export function encrypt(
  data: string,
  key: Buffer,
  keyId?: string,
): EncryptedData {
  try {
    const iv = crypto.randomBytes(CONFIG.ivLength);

    const cipher = crypto.createCipheriv(CONFIG.algorithm, key, iv);

    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");
    const tag = cipher.getAuthTag();

    return {
      data: encrypted,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      keyId,
      version: VERSION,
      encryptedAt: new Date().toISOString(),
    };
  } catch (error) {
    const encryptionError = new Error("Encryption failed") as EncryptionError;
    encryptionError.code = "ENCRYPTION_FAILED";
    encryptionError.error =
      error instanceof Error ? error.message : String(error);
    throw encryptionError;
  }
}

export function decrypt(data: EncryptedData, key: Buffer): string {
  try {
    const iv = Buffer.from(data.iv, "base64");
    const tag = Buffer.from(data.tag, "base64");

    const decipher = crypto.createDecipheriv(CONFIG.algorithm, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(data.data, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    const decryptionError = new Error("Decryption failed") as EncryptionError;
    decryptionError.code = "DECRYPTION_FAILED";
    decryptionError.error =
      error instanceof Error ? error.message : String(error);
    throw decryptionError;
  }
}

export function isEncrypted(data: unknown): data is EncryptedData {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as EncryptedData).data === "string" &&
    typeof (data as EncryptedData).iv === "string" &&
    typeof (data as EncryptedData).tag === "string" &&
    (typeof (data as EncryptedData).keyId === "string" ||
      typeof (data as EncryptedData).keyId === "undefined") &&
    typeof (data as EncryptedData).version === "string" &&
    typeof (data as EncryptedData).encryptedAt === "string"
  );
}

export function generateKey(): Buffer {
  return crypto.randomBytes(CONFIG.keyLength);
}

export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

export function bufferToHex(buffer: Buffer): string {
  return buffer.toString("hex");
}
