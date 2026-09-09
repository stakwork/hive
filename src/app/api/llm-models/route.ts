import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/auth/api-token";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { getModelValue, PROVIDER_API_KEY_ENV_VARS, type LlmModelOption } from "@/lib/ai/models";

/**
 * A model is only actually selectable when its provider's API key is
 * configured in this running environment. Every picker
 * (CanvasAgentSettingsPopover, PlanStartInput, ChatInput,
 * CompactTasksList) renders whatever this endpoint returns with no
 * client-side availability check — clients can't read `process.env`,
 * so this is the only place the check can be correct. Filtering here
 * fixes every picker at once, including the pre-existing case of a
 * Google (or now xAI) row showing up with no key set.
 *
 * A model whose provider maps to no known env var (an `OTHER` row with
 * a custom `providerLabel` we don't recognize, or the bare `OTHER`
 * enum with no label) has nothing to gate on — keep it, unchanged
 * from prior behavior.
 */
function isProviderKeyConfigured(model: LlmModelOption): boolean {
  const value = getModelValue(model);
  const prefix = value.split("/")[0].toUpperCase();
  const envVar = PROVIDER_API_KEY_ENV_VARS[prefix];
  if (!envVar) return true;
  return Boolean(process.env[envVar]);
}

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
    where: {
      isPublic: true,
      OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
    },
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
