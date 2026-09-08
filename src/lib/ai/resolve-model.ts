/**
 * Server-side resolution of a stored model selection against the live
 * LLM catalog.
 *
 * Model selections are persisted as `getModelValue()` strings
 * ("provider/name") in several places — `users.chat_agent_model`,
 * `features.model`, `tasks.model`. The prefix is derived from the
 * catalog row's `provider` / `providerLabel` at pick time, so when an
 * admin later moves a row to a different provider (e.g. an `OTHER`
 * "Grok 4.6" row becoming first-class `XAI`), every stored copy keeps
 * the dead prefix and resolves to no API key.
 *
 * `llm_models.name` is unique, so the part after the first slash
 * identifies at most one row. We look the row up by name and return
 * the value the catalog produces *today*, flagging when it differs
 * from what was stored so callers can heal the persisted copy.
 */
import { db } from "@/lib/db";
import { getModelValue } from "@/lib/ai/models";

export interface CatalogModelResolution {
  /** Live "provider/name" value, or null when no public, unexpired row matches. */
  value: string | null;
  /** True when `value` differs from `stored` (a provider/label cutover). */
  healed: boolean;
}

const CATALOG_SELECT = {
  id: true,
  name: true,
  provider: true,
  providerLabel: true,
  isPlanDefault: true,
  isTaskDefault: true,
} as const;

export async function resolveModelAgainstCatalog(
  stored: string | null | undefined,
): Promise<CatalogModelResolution> {
  if (!stored) return { value: null, healed: false };

  const slash = stored.indexOf("/");
  // Short aliases ("sonnet", "gemini") have no catalog form — pass through.
  if (slash <= 0 || slash === stored.length - 1) {
    return { value: stored, healed: false };
  }
  const name = stored.slice(slash + 1);

  let row: Parameters<typeof getModelValue>[0] | null;
  try {
    row = await db.llmModel.findFirst({
      where: {
        name,
        isPublic: true,
        OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
      },
      select: CATALOG_SELECT,
    });
  } catch (error) {
    // Fail open: a catalog lookup failure must not change routing.
    console.warn(`[resolve-model] catalog lookup failed for "${stored}"; using stored value`, error);
    return { value: stored, healed: false };
  }

  if (!row) return { value: null, healed: false };
  const value = getModelValue(row);
  return { value, healed: value !== stored };
}

/**
 * Resolve a user's stored `chatAgentModel` against the catalog and
 * persist the healed value when the prefix has moved. Returns the live
 * value, or `undefined` when the stored one no longer matches any row
 * (callers then inherit the admin-configured default). An unresolvable
 * value is deliberately NOT cleared in the DB — if the row is
 * re-published the user's choice comes back.
 */
export async function healUserChatAgentModel(
  userId: string,
  stored: string | null | undefined,
): Promise<string | undefined> {
  const { value, healed } = await resolveModelAgainstCatalog(stored);
  if (healed && value) {
    console.log(`[resolve-model] healing chatAgentModel for user ${userId}: "${stored}" -> "${value}"`);
    try {
      await db.user.update({ where: { id: userId }, data: { chatAgentModel: value } });
    } catch (error) {
      console.warn(`[resolve-model] failed to persist healed chatAgentModel for user ${userId}`, error);
    }
  }
  return value ?? undefined;
}

/** Load + heal a user's `chatAgentModel` in one call. */
export async function loadUserChatAgentModel(userId: string): Promise<string | undefined> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { chatAgentModel: true },
  });
  return healUserChatAgentModel(userId, user?.chatAgentModel ?? null);
}

/**
 * Resolve a feature's stored `model` and persist the healed value when
 * the prefix has moved. Returns the live value or `undefined`.
 */
export async function healFeatureModel(
  featureId: string,
  stored: string | null | undefined,
): Promise<string | undefined> {
  const { value, healed } = await resolveModelAgainstCatalog(stored);
  if (stored && !value) {
    console.warn(`[resolve-model] feature ${featureId} model "${stored}" matches no live catalog row; ignoring it`);
  }
  if (healed && value) {
    console.log(`[resolve-model] healing model for feature ${featureId}: "${stored}" -> "${value}"`);
    try {
      await db.feature.update({ where: { id: featureId }, data: { model: value } });
    } catch (error) {
      console.warn(`[resolve-model] failed to persist healed model for feature ${featureId}`, error);
    }
  }
  return value ?? undefined;
}
