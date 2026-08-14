"use client";

/**
 * `useEntityChannel(entityKind, entityId)` — thin, generic wrapper
 * that resolves `getFeatureChannelName` / `getTaskChannelName` and
 * returns the shared refcounted channel via `usePusherChannel`.
 *
 * **No attention-specific logic lives here.** This is the reusable
 * primitive that:
 *   - `AttentionMapContext` uses internally to subscribe to per-entity
 *     channels for entities that currently have an active signal.
 *   - A future "agents working" indicator can use independently to
 *     subscribe to individual task/feature channels without coupling
 *     to the attention system.
 *
 * Returns `null` when:
 *   - Pusher is not configured (`NEXT_PUBLIC_PUSHER_KEY` unset).
 *   - `entityId` is null/undefined (call-site convenience: pass the
 *     parsed id directly, skip the null-guard at the call site).
 */
import type { Channel } from "pusher-js";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import {
  getFeatureChannelName,
  getTaskChannelName,
} from "@/lib/pusher";

export type EntityKind = "feature" | "task";

/**
 * Resolves the Pusher channel name for a given entity kind + id,
 * then delegates lifecycle ownership to `usePusherChannel`'s
 * refcounted subscription manager.
 *
 * @param entityKind - "feature" or "task"
 * @param entityId   - The entity's CUID. Pass `null` to get a null
 *                     channel back without subscribing.
 */
export function useEntityChannel(
  entityKind: EntityKind,
  entityId: string | null | undefined,
): Channel | null {
  const channelName =
    entityId == null
      ? null
      : entityKind === "feature"
        ? getFeatureChannelName(entityId)
        : getTaskChannelName(entityId);

  return usePusherChannel(channelName);
}
