import { encrypt, decrypt, isEncrypted, hexToBuffer } from "./crypto";
import {
  EncryptedData,
  EncryptableField,
  EncryptionError,
} from "@/types/encryption";

export class FieldEncryptionService {
  private key: Buffer;

  constructor(key: string) {
    this.key = hexToBuffer(key);
  }

  encryptField(fieldName: EncryptableField, value: string): EncryptedData {
    if (!value || value.trim() === "") {
      throw new Error(`Cannot encrypt empty value for field: ${fieldName}`);
    }

    try {
      return encrypt(value, this.key);
    } catch (error) {
      const encryptionError = new Error(
        `Failed to encrypt field: ${fieldName}`,
      ) as EncryptionError;
      encryptionError.code = "ENCRYPTION_FAILED";
      encryptionError.field = fieldName;
      encryptionError.error =
        error instanceof Error ? error.message : String(error);
      throw encryptionError;
    }
  }

  decryptField(
    fieldName: EncryptableField,
    encryptedData: EncryptedData,
  ): string {
    try {
      return decrypt(encryptedData, this.key);
    } catch (error) {
      const decryptionError = new Error(
        `Failed to decrypt field: ${fieldName}`,
      ) as EncryptionError;
      decryptionError.code = "DECRYPTION_FAILED";
      decryptionError.field = fieldName;
      decryptionError.error =
        error instanceof Error ? error.message : String(error);
      throw decryptionError;
    }
  }

  encryptObject<T extends Record<string, unknown>>(obj: T): T {
    const encrypted = { ...obj };

    for (const [key, value] of Object.entries(obj)) {
      if (
        this.isEncryptableField(key) &&
        typeof value === "string" &&
        value.trim() !== ""
      ) {
        (encrypted as Record<string, unknown>)[key] = this.encryptField(
          key as EncryptableField,
          value,
        );
      }
    }

    return encrypted;
  }

  decryptObject<T extends Record<string, unknown>>(obj: T): T {
    const decrypted = { ...obj };

    for (const [key, value] of Object.entries(obj)) {
      if (this.isEncryptableField(key) && isEncrypted(value)) {
        (decrypted as Record<string, unknown>)[key] = this.decryptField(
          key as EncryptableField,
          value,
        );
      }
    }

    return decrypted;
  }

  private isEncryptableField(fieldName: string): fieldName is EncryptableField {
    const encryptableFields: EncryptableField[] = [
      "access_token",
      "environmentVariables",
      "poolApiKey",
      "swarmApiKey",
      "stakworkApiKey",
    ];

    return encryptableFields.includes(fieldName as EncryptableField);
  }
}
