/**
 * Client-safe task helpers — no server-only imports.
 *
 * These utilities are shared between server code (tasks.ts) and client
 * components. Keep this file free of Node.js / server-only dependencies.
 */

/**
 * Minimal shape needed by `allWorkflowArtifactsPublished`.
 * Compatible with both the Prisma-backed `TaskPrContext["chatMessages"]` (server)
 * and the frontend `ChatMessage[]` (client) since we only read `id`, `type`, and
 * `content.published`.
 */
export type ChatMessagesSnapshot = Array<{
  artifacts?: Array<{
    id: string;
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: any;
  }>;
}>;

/**
 * Check whether all WORKFLOW and PUBLISH_WORKFLOW artifacts on a task are published.
 *
 * Pass the **pre-publish snapshot** of chatMessages (captured before calling
 * `/api/workflow/publish`) to avoid a race with the new WORKFLOW artifact the
 * backend appends after publishing.
 *
 * @param chatMessages - Pre-publish snapshot of the task's chat messages
 * @param justPublishedArtifactId - ID of the artifact that was just published (treated as published)
 * @returns `true` if every WORKFLOW / PUBLISH_WORKFLOW artifact is published (vacuously true when none exist)
 */
export function allWorkflowArtifactsPublished(
  chatMessages: ChatMessagesSnapshot | undefined,
  justPublishedArtifactId: string,
): boolean {
  if (!chatMessages || chatMessages.length === 0) return true;

  for (const message of chatMessages) {
    if (!message.artifacts || message.artifacts.length === 0) continue;
    for (const artifact of message.artifacts) {
      if (artifact.type !== "WORKFLOW" && artifact.type !== "PUBLISH_WORKFLOW") continue;
      if (artifact.id === justPublishedArtifactId) continue; // just published — treat as done
      const content = artifact.content as { published?: boolean } | null;
      if (content?.published !== true) return false;
    }
  }

  return true;
}
