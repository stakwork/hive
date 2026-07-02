import * as crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Normalise a raw repository identifier (URL or name) so that trivial
 * formatting differences collapse to the same key:
 *   - trim whitespace
 *   - lowercase
 *   - strip trailing slash and .git suffix
 */
function normalizeRepo(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/**
 * Resolve a client-supplied `repository` string (URL or name) to a
 * `Repository` row scoped strictly to the given workspace.
 *
 * Returns:
 *   - `{ repositoryId, repoKey: repositoryId }` when a match is found
 *   - `{ repositoryId: null, repoKey: normalizedRaw }` for unresolved but
 *     non-empty identifiers (so repeat calls with identical raw strings still
 *     land on the same issue)
 *   - `{ repositoryId: null, repoKey: "unknown" }` when `repository` is
 *     absent or empty
 */
export async function resolveRepoKey({
  workspaceId,
  repository,
}: {
  workspaceId: string;
  repository?: string | null;
}): Promise<{ repositoryId: string | null; repoKey: string }> {
  if (!repository || !repository.trim()) {
    return { repositoryId: null, repoKey: "unknown" };
  }

  const normalized = normalizeRepo(repository);

  // Fetch all repos for this workspace and match client-side to avoid
  // complex DB normalisation; workspace repos are typically few.
  const repos = await db.repository.findMany({
    where: { workspaceId },
    select: { id: true, name: true, repositoryUrl: true },
  });

  for (const repo of repos) {
    if (
      normalizeRepo(repo.repositoryUrl) === normalized ||
      normalizeRepo(repo.name) === normalized
    ) {
      return { repositoryId: repo.id, repoKey: repo.id };
    }
  }

  // No match — fall back to normalised raw identifier (or "unknown" if empty
  // after normalization)
  return { repositoryId: null, repoKey: normalized || "unknown" };
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

const TOP_FRAME_COUNT = 5;

/**
 * Normalise a single stack frame so the same logical frame from different
 * releases/machines still hashes identically:
 *   - strip absolute file paths (keep only basename)
 *   - remove line and column numbers
 *   - trim surrounding whitespace
 *
 * Handles common formats:
 *   at FnName (/abs/path/file.ts:10:5)
 *   at Object.<anonymous> (src/file.ts:10:5)
 *   FnName@http://host/bundle.js:100:3
 */
function normalizeFrame(frame: string): string {
  return frame
    .trim()
    // Strip line:column from "file.ts:10:5)" or "file.ts:10:5"
    .replace(/:\d+:\d+\)?$/, "")
    // Strip absolute paths — keep everything from the last "/" onward
    .replace(/\(([^)]*\/)/g, "(")
    // Strip "http(s)://host/..." paths before the last segment
    .replace(/https?:\/\/[^/]+\/[^@)]*\//g, "")
    .trim();
}

/**
 * Compute a stable grouping fingerprint for an error occurrence.
 *
 * If the client supplies a non-empty `clientFingerprint`, it is used as-is
 * (allows intentional grouping override). Otherwise a SHA-256 hash of the
 * exception type + the top N normalised stack frames is produced.
 */
export function computeFingerprint({
  exceptionType,
  stackTrace,
  clientFingerprint,
}: {
  exceptionType: string;
  stackTrace?: string | null;
  clientFingerprint?: string | null;
}): string {
  if (clientFingerprint && clientFingerprint.trim()) {
    return clientFingerprint.trim();
  }

  const frames = stackTrace
    ? stackTrace
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, TOP_FRAME_COUNT)
        .map(normalizeFrame)
    : [];

  const input = [exceptionType, ...frames].join("\n");
  return crypto.createHash("sha256").update(input).digest("hex");
}
