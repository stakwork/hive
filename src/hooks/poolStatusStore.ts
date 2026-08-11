/**
 * poolStatusStore.ts — module-level coordinator for usePoolStatus.
 *
 * Provides two client-only helpers (never executed during SSR):
 *  1. fetchPoolStatusDeduped — deduplicates concurrent in-flight requests for
 *     the same workspace slug so N mounts share one network call.
 *  2. Shared visibility manager — a single `visibilitychange` listener that
 *     notifies all registered "resume" callbacks when the tab becomes visible,
 *     enabling the polling loop to pause while hidden and resume immediately.
 */

import { PoolStatusResponse } from "@/types/pool-manager";

// ---------------------------------------------------------------------------
// 1. In-flight request dedupe
// ---------------------------------------------------------------------------

const inFlightRequests = new Map<
  string,
  Promise<PoolStatusResponse["status"]>
>();

/**
 * Fetch pool status for `slug`, deduplicating concurrent calls.
 * Returns `null` (and issues no request) when `slug` is falsy/empty.
 */
export async function fetchPoolStatusDeduped(
  slug: string | undefined
): Promise<PoolStatusResponse["status"] | null> {
  if (!slug) return null;

  const existing = inFlightRequests.get(slug);
  if (existing) return existing;

  const promise = (async (): Promise<PoolStatusResponse["status"]> => {
    const response = await fetch(`/api/w/${slug}/pool/status`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to fetch pool status");
    }
    if (!result.success) {
      throw new Error(result.error || "Failed to fetch pool status");
    }

    return result.data.status as PoolStatusResponse["status"];
  })();

  // Attach cleanup before storing so the map entry is removed on settle.
  // The `.catch(() => {})` on the cleanup chain prevents a second unhandled-
  // rejection warning; callers that await `promise` directly still receive
  // the real rejection because they hold a reference to the original promise.
  promise.finally(() => inFlightRequests.delete(slug)).catch(() => {});

  inFlightRequests.set(slug, promise);

  return promise;
}

// ---------------------------------------------------------------------------
// 2. Shared visibility manager
// ---------------------------------------------------------------------------

type ResumeCallback = () => void;

const resumeCallbacks = new Set<ResumeCallback>();
let listenerAttached = false;

function handleVisibilityChange() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    resumeCallbacks.forEach((cb) => cb());
  }
}

/**
 * Register a callback to be invoked when the tab transitions to visible.
 * Returns an unregister function; call it on unmount.
 * Safe to call during SSR — guards on `typeof document`.
 */
export function registerResumeCallback(cb: ResumeCallback): () => void {
  if (typeof document === "undefined") {
    // SSR: no-op; return a no-op unregister
    return () => {};
  }

  resumeCallbacks.add(cb);

  if (!listenerAttached) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    listenerAttached = true;
  }

  return () => {
    resumeCallbacks.delete(cb);
    if (resumeCallbacks.size === 0 && listenerAttached) {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      listenerAttached = false;
    }
  };
}

/**
 * Returns `true` when the document is visible (or when running in SSR, where
 * there is no tab concept — treat as visible so initial fetches still fire).
 */
export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}
