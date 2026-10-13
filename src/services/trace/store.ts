/**
 * Storing the trace artifact's ref inline on the source message's
 * `artifacts` — the one write a trace makes to the conversation. Locked
 * the same way the conversations PUT route appends new rows
 * (`SELECT … FOR UPDATE`), so a trace request racing a live turn never
 * loses the other's write.
 */

import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { db } from "@/lib/db";

interface MessageWithArtifacts {
  id: string;
  artifacts?: unknown[];
  [key: string]: unknown;
}

/**
 * Append `ref` to `messageId`'s `artifacts` on `conversationId`, unless an
 * artifact with the same `id` is already there (idempotent on
 * `traceArtifactId` — re-tracing the same span reuses the ref, not a copy).
 * No-ops quietly when the conversation or the message has since gone.
 */
export async function appendTraceArtifact(conversationId: string, messageId: string, ref: ArtifactRef): Promise<void> {
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return;
    const messages = Array.isArray(locked[0].messages) ? (locked[0].messages as MessageWithArtifacts[]) : [];
    const index = messages.findIndex((m) => m && typeof m === "object" && m.id === messageId);
    if (index === -1) return;
    const existing = Array.isArray(messages[index].artifacts) ? (messages[index].artifacts as ArtifactRef[]) : [];
    if (existing.some((a) => a && typeof a === "object" && (a as ArtifactRef).id === ref.id)) return;
    const updated = [...messages];
    updated[index] = { ...updated[index], artifacts: [...existing, ref] };
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { messages: updated as any },
    });
  });
}
