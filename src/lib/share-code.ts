import { db } from "@/lib/db";

const MAX_RETRIES = 10;
const CHARACTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;

/**
 * Generates an 8-character alphanumeric share code (uppercase, lowercase, and digits)
 * @returns A random 8-character string
 */
export function generateShareCode(): string {
  let result = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * CHARACTERS.length);
    result += CHARACTERS[randomIndex];
  }
  return result;
}

/**
 * Generates a unique share code with collision detection
 * Retries up to MAX_RETRIES times if a collision occurs
 * @returns A unique 8-character share code
 * @throws Error if unable to generate unique code after maximum retries
 */
export async function ensureUniqueShareCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateShareCode();
    
    const existing = await db.sharedConversation.findUnique({
      where: { shareCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error("Failed to generate unique share code after maximum retries");
}
