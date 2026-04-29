import { db } from "@/lib/db";
import type { LlmModel, LlmProvider } from "@prisma/client";

export interface CreateTestLlmModelOptions {
  name?: string;
  provider?: LlmProvider;
  providerLabel?: string | null;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  cacheReadPer1MToken?: number | null;
  cacheWritePer1MToken?: number | null;
  dateStart?: Date | null;
  dateEnd?: Date | null;
  isPublic?: boolean;
}

export async function createTestLlmModel(
  overrides: CreateTestLlmModelOptions = {}
): Promise<LlmModel> {
  return db.llmModel.create({
    data: {
      name: "gpt-4o",
      provider: "OPENAI",
      inputPricePer1M: 5.0,
      outputPricePer1M: 15.0,
      ...overrides,
    },
  });
}
