import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Merge two sets of Excalidraw elements using element-level versioning.
 *
 * Used in two places:
 *   1. Applying remote real-time updates received over Pusher
 *   2. Resolving a 409 stale-version conflict during a database save —
 *      where `localElements` is the current canvas state and
 *      `remoteElements` is the freshly-fetched server state.
 *
 * Conflict rules:
 *   - Element only in remote → take remote (new from another client)
 *   - Element only in local  → keep local (we created it OR we have it
 *     pending; if we deleted it, the deletion sweep below removes it)
 *   - Element in both        → take whichever has the higher Excalidraw
 *     element version (last-write-wins per element, with the version field
 *     acting as the logical clock)
 *
 * Note: this is intentionally permissive for concurrent edits. It is NOT a
 * CRDT — concurrent deletes vs. edits will resolve to whichever side bumped
 * the version field most recently. For true conflict-free merging we would
 * need Yjs or a similar library.
 */
export function mergeElementsByVersion(
  localElements: readonly ExcalidrawElement[],
  remoteElements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const localMap = new Map(localElements.map((el) => [el.id, el]));
  const remoteMap = new Map(remoteElements.map((el) => [el.id, el]));
  const mergedMap = new Map<string, ExcalidrawElement>();

  // Start with all local elements.
  for (const [id, el] of localMap) {
    mergedMap.set(id, el);
  }

  // Override with remote elements where remote has the same-or-higher version.
  for (const [id, remoteEl] of remoteMap) {
    const localEl = localMap.get(id);
    if (!localEl) {
      mergedMap.set(id, remoteEl);
    } else if (remoteEl.version >= localEl.version) {
      mergedMap.set(id, remoteEl);
    }
  }

  // If a local element is marked deleted and the remote no longer has it,
  // drop it from the merged result so the deletion propagates.
  for (const [id, localEl] of localMap) {
    if (!remoteMap.has(id) && localEl.isDeleted) {
      mergedMap.delete(id);
    }
  }

  return Array.from(mergedMap.values());
}
