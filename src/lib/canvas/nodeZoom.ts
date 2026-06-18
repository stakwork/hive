/**
 * Compute a targetZoom so the node occupies `fraction` of the
 * container width. Clamped to [0.5, 3.0] to avoid extreme levels.
 */
export function computeNodeFocusZoom(
  nodeWidth: number,
  containerWidth: number,
  fraction = 0.4,
): number {
  if (!nodeWidth || !containerWidth) return 1.5;
  const zoom = (fraction * containerWidth) / nodeWidth;
  return Math.min(Math.max(zoom, 0.5), 3.0);
}
