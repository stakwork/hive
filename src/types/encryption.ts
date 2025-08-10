export interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  keyId?: string;
  version: string;
  encryptedAt: string;
}

export interface EncryptionConfig {
  algorithm: "aes-256-gcm";
  keyLength: 32;
  ivLength: 16;
  tagLength: 16;
}

export type EncryptableField =
  | "access_token"
  | "environmentVariables"
  | "poolApiKey"
  | "swarmApiKey"
  | "stakworkApiKey";

export interface EncryptionError extends Error {
  code:
    | "ENCRYPTION_FAILED"
    | "DECRYPTION_FAILED"
    | "INVALID_KEY"
    | "INVALID_DATA";
  field?: string;
  error?: string;
}
