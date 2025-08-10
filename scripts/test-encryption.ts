import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
import { EncryptionService } from "@/lib/encryption";
if (!process.env.TOKEN_ENCRYPTION_KEY)
  throw new Error("TOKEN_ENCRYPTION_KEY is required");
if (!process.env.TOKEN_ENCRYPTION_KEY_ID)
  throw new Error("TOKEN_ENCRYPTION_KEY_ID is required");
const svc = EncryptionService.getInstance();

const plaintext = "hive-is-super-cool-and-loading-123";
const enc = svc.encryptField("access_token", plaintext);
console.log("Encrypted:", enc);

const dec1 = svc.decryptField("access_token", JSON.stringify(enc));
const dec2 = svc.decryptField("access_token", enc);
console.log("Decrypted(str):", dec1);
console.log("Decrypted(obj):", dec2);
if (dec1 !== plaintext || dec2 !== plaintext) {
  throw new Error("Round-trip failed");
}
console.log("OK");
