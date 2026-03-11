import { optionalEnvVars } from "@/config/env";
import { logger } from "@/lib/logger";

export interface HubPushInput {
  deviceToken: string;
  message: string;
  workspaceSlug: string;
  taskId?: string;
  featureId?: string;
}

export interface HubPushResult {
  success: boolean;
  error?: string;
}

/**
 * Sends a mobile push notification via the Sphinx HUB API.
 * Never throws — failures are logged and returned as { success: false }.
 */
export async function sendHubPushNotification(input: HubPushInput): Promise<HubPushResult> {
  const url = optionalEnvVars.HUB_NOTIFY_URL;

  if (!url) {
    return { success: false, error: "HUB_NOTIFY_URL not configured" };
  }

  const child = input.taskId
    ? `${input.workspaceSlug}/task:${input.taskId}`
    : `${input.workspaceSlug}/feature:${input.featureId}`;

  const payload = {
    v2: true,
    push_environment: "production",
    device_id: input.deviceToken,
    notification: {
      child,
      message: input.message,
      badge: null,
      sound: "default",
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const error = `HUB API returned ${response.status}: ${errorText}`;
      logger.error("[HubPush] Push notification failed", "HUB_PUSH", { error, child });
      return { success: false, error };
    }

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("[HubPush] Push notification request failed", "HUB_PUSH", { error, child });
    return { success: false, error };
  }
}
