/**
 * Decrypt JSON File Script
 *
 * Decrypts encrypted JSON files using the same TOKEN_ENCRYPTION_KEY that production uses.
 *
 * Usage:
 *   npm run decrypt-json <path-to-json-file>
 *
 * Examples:
 *   npm run decrypt-json ./data/encrypted-data.json
 *   npm run decrypt-json ./data/encrypted-data.json > ./data/decrypted-data.json
 *
 * The script recursively walks through the JSON structure and decrypts any fields
 * that match the encrypted data format (objects with data, iv, tag, version, encryptedAt).
 *
 * Required environment variables:
 *   - TOKEN_ENCRYPTION_KEY: The encryption key (same as production)
 *   - TOKEN_ENCRYPTION_KEY_ID: Optional, defaults to "default"
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
import { EncryptionService } from "@/lib/encryption";
import { isEncrypted } from "@/lib/encryption/crypto";
import * as fs from "fs";
import * as path from "path";

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
}

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npm run decrypt-json <path-to-json-file>");
  console.error("Example: npm run decrypt-json ./data/encrypted-data.json");
  process.exit(1);
}

const absolutePath = path.resolve(filePath);

if (!fs.existsSync(absolutePath)) {
  console.error(`File not found: ${absolutePath}`);
  process.exit(1);
}

try {
  const fileContent = fs.readFileSync(absolutePath, "utf8");
  const jsonData = JSON.parse(fileContent);

  const encryptionService = EncryptionService.getInstance();

  function decryptRecursive(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => decryptRecursive(item));
    }

    if (typeof obj === "object") {
      if (isEncrypted(obj)) {
        try {
          return encryptionService.decryptField("access_token", obj);
        } catch (error) {
          console.error(
            "Warning: Failed to decrypt encrypted data:",
            error instanceof Error ? error.message : String(error),
          );
          return obj;
        }
      }

      const result: Record<string, unknown> = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          result[key] = decryptRecursive((obj as Record<string, unknown>)[key]);
        }
      }
      return result;
    }

    if (typeof obj === "string") {
      try {
        const parsed = JSON.parse(obj);
        if (isEncrypted(parsed)) {
          return encryptionService.decryptField("access_token", parsed);
        }
      } catch {
        // Not JSON or not encrypted, return as-is
      }
    }

    return obj;
  }

  const decryptedData = decryptRecursive(jsonData);

  console.log(JSON.stringify(decryptedData, null, 2));
} catch (error) {
  console.error("Error processing file:", error);
  process.exit(1);
}
