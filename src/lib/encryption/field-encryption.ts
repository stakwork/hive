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
    encryptedData: EncryptedData | string,
  ): string {
    try {
      if (typeof encryptedData === "string") {
        try {
          const parsed = JSON.parse(encryptedData);
          if (isEncrypted(parsed)) {
            return decrypt(parsed, this.key);
          }
        } catch {
          return encryptedData;
        }
        return encryptedData;
      } else if (isEncrypted(encryptedData)) {
        return decrypt(encryptedData, this.key);
      } else {
        throw new Error("Invalid encrypted data format");
      }
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
