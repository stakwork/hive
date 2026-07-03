import * as crypto from "crypto";
import { db } from "@/lib/db";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import type { StructuredFrame } from "@/lib/utils/error-frames";

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
 * Canonicalize any repository identifier (SSH URL, HTTPS URL, or owner/repo
 * shorthand) to lowercase `owner/repo` form.
 *
 * - Uses `parseGithubOwnerRepo` to handle SSH and HTTPS GitHub URLs.
 * - Falls back to `normalizeRepo` for shorthand `owner/repo` strings and
 *   non-GitHub URLs (which still benefit from trim/lowercase/.git stripping).
 * - Returns `"unknown"` when the result is empty.
 */
export function canonicalRepoKey(raw: string): string {
  if (!raw || !raw.trim()) return "unknown";
  try {
    const { owner, repo } = parseGithubOwnerRepo(raw.trim());
    return `${owner}/${repo}`.toLowerCase();
  } catch {
    const normalized = normalizeRepo(raw);
    return normalized || "unknown";
  }
}

/**
 * Resolve a client-supplied `repository` string (URL or name) to a
 * `Repository` row scoped strictly to the given workspace.
 *
 * Returns:
 *   - `{ repositoryId, repoKey: canonicalRepoKey(repo.repositoryUrl || repo.name) }` when a match is found
 *   - `{ repositoryId: null, repoKey: canonicalRepoKey(repository) }` for unresolved but
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

  // Fetch all repos for this workspace and match client-side to avoid
  // complex DB normalisation; workspace repos are typically few.
  const repos = await db.repository.findMany({
    where: { workspaceId },
    select: { id: true, name: true, repositoryUrl: true },
  });

  const canonicalIncoming = canonicalRepoKey(repository);

  for (const repo of repos) {
    const matchUrl = repo.repositoryUrl ? canonicalRepoKey(repo.repositoryUrl) : null;
    const matchName = repo.name ? canonicalRepoKey(repo.name) : null;
    const matched = matchUrl === canonicalIncoming || matchName === canonicalIncoming;
    if (matched) {
      const method = matchUrl === canonicalIncoming ? "url" : "name";
      console.info("[resolveRepoKey] matched", {
        method,
        incoming: canonicalIncoming,
        repoId: repo.id,
      });
      return {
        repositoryId: repo.id,
        repoKey: canonicalRepoKey(repo.repositoryUrl || repo.name),
      };
    }
  }

  // No match — fall back to canonical form of the raw identifier
  return { repositoryId: null, repoKey: canonicalIncoming };
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
 * (allows intentional grouping override). Otherwise:
 *   - When `frames` are provided (structured), hash the top N frames'
 *     `filename|function|lineno` — stable across deploys and machines.
 *   - Otherwise fall back to hashing the top N normalised raw stack-trace lines.
 */
export function computeFingerprint({
  exceptionType,
  stackTrace,
  clientFingerprint,
  frames,
}: {
  exceptionType: string;
  stackTrace?: string | null;
  clientFingerprint?: string | null;
  frames?: StructuredFrame[];
}): string {
  if (clientFingerprint && clientFingerprint.trim()) {
    return clientFingerprint.trim();
  }

  // Structured frames path — stable, no raw-string splitting
  if (frames && frames.length > 0) {
    const frameKeys = frames
      .slice(0, TOP_FRAME_COUNT)
      .map((f) => `${f.filename}|${f.function ?? ""}|${f.lineno ?? ""}`);
    const input = [exceptionType, ...frameKeys].join("\n");
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  // Legacy raw-string path — unchanged behaviour
  const rawLines = stackTrace
    ? stackTrace
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, TOP_FRAME_COUNT)
        .map(normalizeFrame)
    : [];

  const input = [exceptionType, ...rawLines].join("\n");
  return crypto.createHash("sha256").update(input).digest("hex");
}
