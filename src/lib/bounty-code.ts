import { db } from "@/lib/db";

const MAX_RETRIES = 10;

export function generateBountyCode(): string {
  const randomNumber = Math.floor(Math.random() * 1000000);
  return randomNumber.toString().padStart(6, "0");
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
