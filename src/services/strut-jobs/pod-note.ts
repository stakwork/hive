/**
 * The note a job's prompt carries when it names a workspace that has no
 * pods. The job agent's "Code Change" page sends anything beyond a tiny diff
 * to a pod; a workspace with no pod pool can only answer "no pod available",
 * so the job is told, as a fact, that building and testing are optional there.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const NO_PODS_MARKER = "[hive] Workspace @";

const SLUG_MENTION = /(?<![\w@])@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/gi;

/** Slugs named as `@<slug>` in the text, lower-cased and de-duplicated. */
function mentionedSlugs(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(SLUG_MENTION)].map((m) => m[1].toLowerCase()))];
}

/**
 * Of the workspaces the prompt names as `@<slug>`, the slugs with no usable
 * pod pool: no swarm, no pool API key, or a pool that is not COMPLETE.
 * Unknown slugs are ignored. Never throws — a failed lookup is `[]`.
 */
export async function podlessWorkspaceSlugs(prompt: string): Promise<string[]> {
  const slugs = mentionedSlugs(prompt);
  if (slugs.length === 0) return [];
  try {
    const rows = await db.workspace.findMany({
      where: { slug: { in: slugs }, deleted: false },
      select: { slug: true, swarm: { select: { poolApiKey: true, poolState: true, poolName: true } } },
    });
    return rows.filter((w) => !w.swarm || !w.swarm.poolApiKey || w.swarm.poolState !== "COMPLETE").map((w) => w.slug);
  } catch (err) {
    logger.warn("pod-less workspace lookup failed; sending the prompt unchanged", "STRUT_JOB", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** The prompt with a no-pods note appended for each pod-less workspace it names; unchanged when none. */
export async function withNoPodsNote(prompt: string): Promise<string> {
  if (prompt.includes(NO_PODS_MARKER)) return prompt;
  const slugs = await podlessWorkspaceSlugs(prompt);
  if (slugs.length === 0) return prompt;
  const notes = slugs.map(
    (slug) =>
      `${NO_PODS_MARKER}${slug} has no pods (no pod pool is set up), so do NOT claim a pod for it and do not treat a missing pod as a blocker: building, running and testing are optional there. Make the code change without a pod (the code-change-pr workflow) and open the pull request; say in the PR summary that it was not built or tested.`,
  );
  return `${prompt}\n\n${notes.join("\n")}`;
}
