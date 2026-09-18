import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/auth/api-token";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import {
  isProviderKeyConfigured,
  publicUnexpiredLlmModelWhere,
} from "@/lib/ai/llm-model-availability";

export async function GET(request: NextRequest) {
  // Allow either a valid API token or an authenticated session
  const isApiToken = validateApiToken(request);
  if (!isApiToken) {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }
  }

  const models = await db.llmModel.findMany({
    where: publicUnexpiredLlmModelWhere(),
    select: {
      id: true,
      name: true,
      provider: true,
      providerLabel: true,
      isPlanDefault: true,
      isTaskDefault: true,
      isPublic: true,
      inputPricePer1M: true,
      outputPricePer1M: true,
      cacheReadPer1MToken: true,
      cacheWritePer1MToken: true,
    },
    orderBy: { name: "asc" },
  });

  const availableModels = models.filter(isProviderKeyConfigured);

  return NextResponse.json({ models: availableModels });
}
