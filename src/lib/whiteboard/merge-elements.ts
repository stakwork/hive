import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Merge two sets of Excalidraw elements using element-level versioning.
 *
 * Used in two places:
 *   1. Applying remote real-time updates received over the relay
 *   2. Resolving a 409 stale-version conflict during a database save —
 *      where `localElements` is the current canvas state and
 *      `remoteElements` is the freshly-fetched server state.
 *
 * Conflict rules:
 *   - Element only in remote → take remote (new from another client)
 *   - Element only in local  → keep local (we created it OR we have it
 *     pending; tombstones are preserved even when absent from the remote)
 *   - Local tombstone vs. remote alive → KEEP THE TOMBSTONE. A local
 *     deletion must not be resurrected by an incoming non-deleted snapshot,
 *     even at a higher Excalidraw version. The other side often bumps
 *     `version` for non-content reasons (selection/hover/binding) and may
 *     not have received our delete yet — applying their state would
 *     un-delete the element on screen.
 *   - Element in both, both alive (or both deleted) → take whichever has
 *     the higher Excalidraw element version (last-write-wins per element).
 *
 * Note: this is intentionally permissive for concurrent edits. It is NOT a
 * CRDT — sticky tombstones mean a remote "undelete" (e.g., another client
 * pressing Ctrl+Z to undo our delete) won't propagate back to us via this
 * merge; they'd need to recreate the element. For true conflict-free
 * merging we would need Yjs or similar.
 */
export function mergeElementsByVersion(
  localElements: readonly ExcalidrawElement[],
  remoteElements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const localMap = new Map(localElements.map((el) => [el.id, el]));
  const remoteMap = new Map(remoteElements.map((el) => [el.id, el]));
  const mergedMap = new Map<string, ExcalidrawElement>();

  for (const [id, el] of localMap) {
    mergedMap.set(id, el);
  }

  for (const [id, remoteEl] of remoteMap) {
    const localEl = localMap.get(id);
    if (!localEl) {
      mergedMap.set(id, remoteEl);
    } else if (localEl.isDeleted && !remoteEl.isDeleted) {
      console.info("[whiteboard-merge] tombstone preserved (resurrection blocked)", {
        id,
        localVersion: localEl.version,
        remoteVersion: remoteEl.version,
      });
    } else if (remoteEl.version >= localEl.version) {
      mergedMap.set(id, remoteEl);
    }
  }

  // Tombstones for elements absent from the remote (delta or full-sync) are
  // intentionally preserved. In delta sync, absence means "no change", not
  // "element doesn't exist". Keeping the tombstone also self-heals the DB if
  // a prior stale save already stripped it.

  return Array.from(mergedMap.values());
}
