import { FieldEncryptionService } from "./field-encryption";
import { generateKey, bufferToHex } from "./crypto";
import { EncryptableField, EncryptedData } from "@/types";

export class EncryptionService {
  private fieldEncryption: FieldEncryptionService;
  private static instance: EncryptionService;

  private constructor(keyHex: string) {
    this.fieldEncryption = new FieldEncryptionService(keyHex);
  }

  static initialize(keyHex: string): void {
    EncryptionService.instance = new EncryptionService(keyHex);
  }

  static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      throw new Error(
        "EncryptionService not initialized. Call initialize() first.",
      );
    }
    return EncryptionService.instance;
  }

  encryptField(fieldName: EncryptableField, value: string): EncryptedData {
    return this.fieldEncryption.encryptField(fieldName, value);
  }

  decryptField(
    fieldName: EncryptableField,
    encryptedData: EncryptedData,
  ): string {
    return this.fieldEncryption.decryptField(fieldName, encryptedData);
  }

  encryptObject<T extends Record<string, unknown>>(obj: T): T {
    return this.fieldEncryption.encryptObject(obj);
  }

  decryptObject<T extends Record<string, unknown>>(obj: T): T {
    return this.fieldEncryption.decryptObject(obj);
  }

  static generateKey(): string {
    return bufferToHex(generateKey());
  }
}

export * from "./crypto";
export * from "./field-encryption";
export * from "@/types/encryption";
