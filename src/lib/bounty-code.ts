import { db } from "@/lib/db";
import { randomUUID } from "crypto";

const MAX_RETRIES = 10;

export function generateBountyCode(): string {
  return randomUUID();
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
