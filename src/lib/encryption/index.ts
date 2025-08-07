import { FieldEncryptionService } from "./field-encryption";
import { generateKey, bufferToHex } from "./crypto";
import { EncryptableField, EncryptedData } from "@/types";

export class EncryptionService {
  private fieldEncryption: FieldEncryptionService | null = null;
  private static instance: EncryptionService;

  private constructor() {}

  private getFieldEncryption(): FieldEncryptionService {
    if (!this.fieldEncryption) {
      const key = process.env.TOKEN_ENCRYPTION_KEY;
      if (!key) {
        throw new Error("TOKEN_ENCRYPTION_KEY environment variable is not set");
      }
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
    return this.getFieldEncryption().encryptField(fieldName, value);
  }

  decryptField(
    fieldName: EncryptableField,
    encryptedData: EncryptedData | string,
  ): string {
    return this.getFieldEncryption().decryptField(fieldName, encryptedData);
  }

  encryptObject<T extends Record<string, unknown>>(obj: T): T {
    return this.getFieldEncryption().encryptObject(obj);
  }

  decryptObject<T extends Record<string, unknown>>(obj: T): T {
    return this.getFieldEncryption().decryptObject(obj);
  }

  static generateKey(): string {
    return bufferToHex(generateKey());
  }
}

export * from "./crypto";
export * from "./field-encryption";
export * from "@/types/encryption";
