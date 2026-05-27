/**
 * Derive a Pusher-safe channel name for a canvas presence room.
 * Colons and other non-alphanumeric characters (except `_`, `-`, `=`, `@`)
 * are replaced with hyphens to satisfy Pusher's channel name restrictions.
 */
export function getCanvasPresenceChannelName(
  githubLogin: string,
  canvasRef: string,
): string {
  const safeRef = (canvasRef || "root").replace(/[^a-zA-Z0-9_\-=@]/g, "-");
  return `canvas-presence-${githubLogin}-${safeRef}`;
}
