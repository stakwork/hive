import { FieldEncryptionService } from "./field-encryption";
import { generateKey, bufferToHex, hexToBuffer } from "./crypto";
import * as cryptoModule from "./crypto";
import { EncryptableField, EncryptedData } from "@/types";

export class EncryptionService {
  private fieldEncryption: FieldEncryptionService | null = null;
  private static instance: EncryptionService;
  private keyRegistry: Map<string, Buffer> = new Map();
  private activeKeyId: string | null = null;

  private constructor() {}

  private getFieldEncryption(): FieldEncryptionService {
    if (!this.fieldEncryption) {
      const key = process.env.TOKEN_ENCRYPTION_KEY;
      const keyId = process.env.TOKEN_ENCRYPTION_KEY_ID || "default";
      if (!key) {
        throw new Error("TOKEN_ENCRYPTION_KEY environment variable is not set");
      }

      this.setKey(keyId, key);
      this.setActiveKeyId(keyId);
      this.fieldEncryption = new FieldEncryptionService(key);
    }
    return this.fieldEncryption;
  }

  static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
    }
    return EncryptionService.instance;
  }

  encryptField(fieldName: EncryptableField, value: string): EncryptedData {
    this.getFieldEncryption();
    const keyId = this.activeKeyId || "default";
    const keyBuffer = this.keyRegistry.get(keyId);
    if (!keyBuffer) {
      throw new Error(`Active encryption key '${keyId}' not found in registry`);
    }

    return cryptoModule.encrypt(value, keyBuffer, keyId);
  }

  encryptFieldWithKeyId(
    fieldName: EncryptableField,
    value: string,
    keyId: string,
  ): EncryptedData {
    // Ensure registry initialized
    this.getFieldEncryption();
    const keyBuffer = this.keyRegistry.get(keyId);
    if (!keyBuffer) {
      throw new Error(`Encryption key for keyId '${keyId}' not found`);
    }
    return cryptoModule.encrypt(value, keyBuffer, keyId);
  }

  decryptField(
    fieldName: EncryptableField,
    encryptedData: EncryptedData | string,
  ): string {
    this.getFieldEncryption();

    if (typeof encryptedData === "string") {
      try {
        const parsed = JSON.parse(encryptedData);
        if (cryptoModule.isEncrypted(parsed)) {
          const keyId = parsed.keyId || this.activeKeyId || "default";
          const keyBuffer = this.keyRegistry.get(keyId);
          if (!keyBuffer) {
            throw new Error(`Decryption key for keyId '${keyId}' not found`);
          }
          return cryptoModule.decrypt(parsed, keyBuffer);
        }
        return encryptedData;
      } catch {
        return encryptedData;
      }
    }

    if (cryptoModule.isEncrypted(encryptedData)) {
      const keyId = encryptedData.keyId || this.activeKeyId || "default";
      const keyBuffer = this.keyRegistry.get(keyId);
      if (!keyBuffer) {
        throw new Error(`Decryption key for keyId '${keyId}' not found`);
      }
      return cryptoModule.decrypt(encryptedData, keyBuffer);
    }

    throw new Error("Invalid encrypted data format");
  }
  static generateKey(): string {
    return bufferToHex(generateKey());
  }

  setKey(keyId: string, hexKey: string): void {
    const buf = hexToBuffer(hexKey);
    this.keyRegistry.set(keyId, buf);
  }

  setActiveKeyId(keyId: string): void {
    this.activeKeyId = keyId;
  }

  getActiveKeyId(): string | null {
    return this.activeKeyId;
  }

  getKey(keyId: string): Buffer | undefined {
    return this.keyRegistry.get(keyId);
  }
}

export * from "./crypto";
export * from "./field-encryption";
export * from "@/types/encryption";

export type EnvVar = { name: string; value: string };
export type EncryptedEnvVar = { name: string; value: EncryptedData };

export function encryptEnvVars(vars: EnvVar[]): EncryptedEnvVar[] {
  const enc = EncryptionService.getInstance();
  return vars.map((v) => ({
    name: v.name,
    value: enc.encryptField("environmentVariables", v.value),
  }));
}

export function decryptEnvVars(
  vars: Array<{ name: string; value: unknown }>,
): EnvVar[] {
  const enc = EncryptionService.getInstance();
  return vars.map((v) => ({
    name: v.name,
    value: enc.decryptField(
      "environmentVariables",
      v.value as EncryptedData | string,
    ),
  }));
}
