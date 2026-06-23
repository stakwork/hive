import { NotificationTriggerType } from "@prisma/client";

/**
 * Default notification preferences for all 11 types.
 *
 * NOTE: GRAPH_CHAT_RESPONSE defaults to false for UI display only.
 * The send gate (isNotificationEnabled) always returns true for missing/null
 * keys, so this default is NOT used to block sends — it only controls what
 * the GET endpoint returns when the user has not set a preference.
 */
export const DEFAULT_NOTIFICATION_PREFS: Record<NotificationTriggerType, boolean> = {
  TASK_ASSIGNED: true,
  FEATURE_ASSIGNED: true,
  PLAN_AWAITING_CLARIFICATION: true,
  PLAN_AWAITING_APPROVAL: true,
  PLAN_TASKS_GENERATED: true,
  WORKFLOW_HALTED: true,
  FEATURE_COMPLETED: true,
  FEATURE_DEPLOYED_PRODUCTION: true,
  TASK_PR_MERGED: true,
  GRAPH_CHAT_RESPONSE: false,
  WORKSPACE_ACCESS_REQUEST: true,
};

/**
 * SEND GATE: determines whether a notification should be sent.
 *
 * Backward-compatibility rules (null/missing/empty → always send):
 * - stored === null or non-object → true
 * - key missing from stored object → true
 * - key present and explicitly false → false
 * - key present and true (or any other truthy value) → true
 */
export function isNotificationEnabled(
  stored: unknown,
  type: NotificationTriggerType
): boolean {
  if (!stored || typeof stored !== "object") return true;
  const val = (stored as Record<string, unknown>)[type];
  if (val === undefined) return true;
  return val !== false;
}

/**
 * GET RESPONSE: merges stored prefs with defaults.
 * Returns a full record with all 11 types, applying GRAPH_CHAT_RESPONSE=false
 * as the display default when not explicitly set by the user.
 */
export function getResolvedPreferences(
  stored: unknown
): Record<NotificationTriggerType, boolean> {
  const result = { ...DEFAULT_NOTIFICATION_PREFS };
  if (!stored || typeof stored !== "object") return result;
  for (const key of Object.keys(result) as NotificationTriggerType[]) {
    if (key in (stored as object)) {
      result[key] = Boolean((stored as Record<string, unknown>)[key]);
    }
  }
  return result;
}

/**
 * PATCH VALIDATION: validates that all keys are valid NotificationTriggerType
 * values and all values are booleans. Throws on invalid input.
 */
export function validatePreferencesUpdate(
  body: unknown
): Partial<Record<NotificationTriggerType, boolean>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Body must be a JSON object");
  }
  const validKeys = new Set<string>(Object.keys(DEFAULT_NOTIFICATION_PREFS));
  const result: Partial<Record<NotificationTriggerType, boolean>> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!validKeys.has(key)) throw new Error(`Invalid notification type: ${key}`);
    if (typeof value !== "boolean") throw new Error(`Value for ${key} must be a boolean`);
    result[key as NotificationTriggerType] = value;
  }
  return result;
}
