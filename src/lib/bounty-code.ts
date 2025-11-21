import { db } from "@/lib/db";

const MAX_RETRIES = 10;
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 6;

export function generateBountyCode(): string {
  let result = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * LETTERS.length);
    result += LETTERS[randomIndex];
  }
  return result;
}

export async function ensureUniqueBountyCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateBountyCode();

    const existing = await db.task.findUnique({
      where: { bountyCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error("Failed to generate unique bounty code after maximum retries");
}
