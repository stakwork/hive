"use client";

import { useEffect, useState } from "react";
import type { Channel } from "pusher-js";
import { getPusherClient } from "@/lib/pusher";

/**
 * Refcounted Pusher channel subscription.
 *
 * `pusher-js`'s `subscribe(name)` and `unsubscribe(name)` operate on a
 * process-wide channel registry — calling `unsubscribe` from one
 * component tears down the same `Channel` instance any other
 * component is bound to. That makes it unsafe to pair subscribe and
 * unsubscribe inside a single component's effect when the same
 * channel is used by sibling components (which is exactly the case on
 * the org canvas page: `OrgCanvasBackground` and `ConnectionsListBody`
 * both bind to `org-{githubLogin}`).
 *
 * This hook centralizes the lifecycle: every consumer asking for the
 * same channel name shares one subscription, and we only call
 * `pusher.unsubscribe(name)` after the last consumer unmounts. Each
 * consumer is still responsible for `bind()` / `unbind()`-ing its own
 * event handlers — only subscribe/unsubscribe is shared.
 *
 * Returns `null` when Pusher isn't configured (no
 * `NEXT_PUBLIC_PUSHER_KEY`). Consumers should bail in that case.
 */

interface Entry {
  count: number;
  channel: Channel;
}

const entries = new Map<string, Entry>();

function acquire(name: string): Channel | null {
  if (!process.env.NEXT_PUBLIC_PUSHER_KEY) return null;

  const existing = entries.get(name);
  if (existing) {
    existing.count += 1;
    return existing.channel;
  }
  const pusher = getPusherClient();
  const channel = pusher.subscribe(name);
  entries.set(name, { count: 1, channel });
  return channel;
}

function release(name: string): void {
  const entry = entries.get(name);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count > 0) return;
  entries.delete(name);
  if (process.env.NEXT_PUBLIC_PUSHER_KEY) {
    try {
      getPusherClient().unsubscribe(name);
    } catch (err) {
      console.error(`[usePusherChannel] unsubscribe(${name}) failed`, err);
    }
  }
}

export function usePusherChannel(channelName: string | null): Channel | null {
  // The effect below is the single owner of the lifecycle. We use
  // state only to expose the live `Channel` reference to the consumer
  // — it lands on the second render. That delay is fine because
  // consumers `bind()` inside their own effects, which run after this
  // one resolves the channel.
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    if (!channelName) {
      setChannel(null);
      return;
    }
    const acquired = acquire(channelName);
    setChannel(acquired);

    return () => {
      release(channelName);
      // Don't null out state on cleanup — React StrictMode runs the
      // mount/unmount/mount cycle synchronously and a stale `null`
      // would wipe the freshly acquired channel.
    };
  }, [channelName]);

  return channel;
}

// Test-only helpers. NOT exported from a public barrel; tests import
// directly from this module.
export function __resetUsePusherChannelForTests(): void {
  entries.clear();
}

export function __getRefCountForTests(name: string): number {
  return entries.get(name)?.count ?? 0;
}
