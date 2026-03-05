/**
 * Returns the count of IDs that differ between the current set and the
 * last snapshot set (symmetric difference).
 */
export function computeVersionChanges(
  currentIds: Set<string>,
  lastSnapshotIds: Set<string>
): number {
  let diff = 0;
  for (const id of currentIds) {
    if (!lastSnapshotIds.has(id)) diff++;
  }
  for (const id of lastSnapshotIds) {
    if (!currentIds.has(id)) diff++;
  }
  return diff;
}
