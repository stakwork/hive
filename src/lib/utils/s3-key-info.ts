/**
 * Shared S3 key ownership parsing.
 *
 * S3 keys follow a `<prefix>/<id>/...` layout. Callers use this to
 * enforce that a caller-supplied key belongs to the workspace/org they
 * actually have access to (IDOR hardening). A `null` result must be
 * treated as a 404 — never as "allow".
 *
 * Supported prefixes mirror the generators on `S3Service`:
 *   - uploads/<workspaceId>/<swarmId>/<taskId>/...
 *   - workspace-logos/<workspaceId>/...
 *   - whiteboards/<workspaceId>/...
 *   - screenshots/<workspaceId>/...
 *   - features/<workspaceId>/...
 *   - diagrams/<workspaceId>/...
 *   - orgs/<sourceControlOrgId>/...
 */
export type S3KeyInfo =
  | { type: "workspace"; id: string }
  | { type: "org"; id: string };

const WORKSPACE_PREFIXES = new Set([
  "uploads",
  "workspace-logos",
  "whiteboards",
  "screenshots",
  "features",
  "diagrams",
]);

export function extractS3KeyInfo(s3Key: string): S3KeyInfo | null {
  const parts = s3Key.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [prefix, id] = parts;
  if (WORKSPACE_PREFIXES.has(prefix)) return { type: "workspace", id: id || "" };
  if (prefix === "orgs") return { type: "org", id: id || "" };
  return null;
}
