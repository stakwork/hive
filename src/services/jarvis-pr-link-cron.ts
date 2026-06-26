/**
 * Jarvis PR-link cron.
 *
 * Draws `HiveTask -RESULTED_IN-> PullRequest` edges connecting a Hive task to
 * the *existing* codegraph `PullRequest` node its agent produced. This is a
 * separate, retry-oriented job (not part of the entity mirror) because the
 * trigger is "the PR node now exists in the graph" — which the mirror's
 * updatedAt keyset cursor can't observe (the task may never change again).
 *
 * Design:
 *  - A task's PR reference is the `content.url` of its `PULL_REQUEST` artifact
 *    (repo + number parsed from the URL — the only reliable source).
 *  - PR nodes are matched on the stable `repo` + `number` properties and linked
 *    by `ref_id` (never node_key) so we never create a stub.
 *  - PR fetch: `latest-by-types` is newest-ingested-first. First run / backfill
 *    pulls the full set; later runs pull only PRs newer than a per-workspace
 *    high-water (`jarvisSyncState.prLink.highWater`). The high-water is advanced
 *    ONLY on a fully-drained (uncapped) pass — while a backfill is still capped
 *    and self-chaining, the remaining unlinked tasks point at old PRs, so each
 *    chained run must keep pulling the full set.
 *  - Per-task marker (`Task.jarvisPrLinkedAt`) keeps the scan cheap and is the
 *    retry latch; best-effort per workspace (one failure never aborts others).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ArtifactType } from "@prisma/client";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addEdgeBulk, searchLatestByTypes } from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import {
  PULL_REQUEST,
  parsePullRequestUrl,
  prNodeKey,
  taskPrEdge,
} from "@/services/jarvis-mirror/mappers";

const LOG = "JARVIS_PR_LINK";

export const DEFAULT_MAX_PER_RUN = 500;
export const BULK_CHUNK = 100;

// Single fetch large enough to return any realistic workspace's entire PR set
// (the endpoint returns min(limit, total)); used for backfill.
const FULL_LIMIT = 100_000;
// Newest-window size for incremental fetches; widened if the boundary (a node
// at-or-below the high-water) isn't reached.
const INCREMENTAL_LIMIT = 2_000;

interface SyncState {
  prLink?: { highWater?: string };
  [key: string]: unknown;
}

export interface WorkspacePrLinkResult {
  workspaceId: string;
  slug: string;
  skipped?: string;
  linked?: number;
  pending?: number;
  capped?: boolean;
  errors?: string[];
}

export interface PrLinkRunResult {
  processed: number;
  anyCapped: boolean;
  results: WorkspacePrLinkResult[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseState(raw: unknown): SyncState {
  if (raw && typeof raw === "object") return raw as SyncState;
  return {};
}

function readHighWaterSec(state: SyncState): number {
  const iso = state.prLink?.highWater;
  if (typeof iso !== "string") return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

/**
 * Fetch `PullRequest` nodes newer than `sinceSec` (0 = backfill / all), with
 * properties. Returns the matching nodes plus the newest `date_added_to_graph`
 * observed across the whole fetch (for advancing the high-water). The endpoint
 * has no server-side filter, so for incremental fetches we widen the window
 * until a node at-or-below the boundary appears (proving completeness).
 */
async function fetchPrNodesSince(
  config: JarvisConnectionConfig,
  sinceSec: number,
): Promise<{ nodes: Awaited<ReturnType<typeof searchLatestByTypes>>; newestSec: number }> {
  let limit = sinceSec === 0 ? FULL_LIMIT : INCREMENTAL_LIMIT;

  for (;;) {
    const nodes = await searchLatestByTypes(config, { [PULL_REQUEST]: limit }, { withProperties: true });
    const newestSec = nodes[0]?.date_added_to_graph ?? 0;
    const oldestSec = nodes[nodes.length - 1]?.date_added_to_graph ?? 0;

    // Boundary reached when we got fewer than asked (exhausted the type) or the
    // oldest returned node is already at/under the high-water.
    const reachedBoundary = nodes.length < limit || oldestSec <= sinceSec;

    if (reachedBoundary || limit >= FULL_LIMIT) {
      const filtered =
        sinceSec === 0
          ? nodes
          : nodes.filter((n) => (n.date_added_to_graph ?? 0) > sinceSec);
      return { nodes: filtered, newestSec };
    }
    limit = Math.min(limit * 4, FULL_LIMIT);
  }
}

/** repo#number → ref_id, from PR graph nodes. Skips nodes missing properties. */
function buildPrMap(
  nodes: Awaited<ReturnType<typeof searchLatestByTypes>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    const repo = n.properties?.repo;
    const number = n.properties?.number;
    if (typeof repo === "string" && typeof number === "number" && n.ref_id) {
      map.set(prNodeKey(repo, number), n.ref_id);
    }
  }
  return map;
}

type CandidateTask = {
  id: string;
  title: string;
  chatMessages: { artifacts: { content: unknown }[] }[];
};

/** Distinct parsed PR refs ({ repo, number }) across a task's PR artifacts. */
function taskPrRefs(task: CandidateTask): { repo: string; number: number }[] {
  const seen = new Map<string, { repo: string; number: number }>();
  for (const msg of task.chatMessages) {
    for (const art of msg.artifacts) {
      const content = art.content as { url?: unknown } | null;
      const ref = parsePullRequestUrl(content?.url);
      if (ref) seen.set(prNodeKey(ref.repo, ref.number), ref);
    }
  }
  return [...seen.values()];
}

async function linkWorkspace(
  workspace: { id: string; slug: string; jarvisSyncState: unknown },
  config: JarvisConnectionConfig,
  maxPerRun: number,
): Promise<WorkspacePrLinkResult> {
  const errors: string[] = [];

  const tasks: CandidateTask[] = await db.task.findMany({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      archived: false,
      jarvisPrLinkedAt: null,
      chatMessages: { some: { artifacts: { some: { type: ArtifactType.PULL_REQUEST } } } },
    },
    orderBy: { createdAt: "asc" },
    take: maxPerRun,
    select: {
      id: true,
      title: true,
      chatMessages: {
        where: { artifacts: { some: { type: ArtifactType.PULL_REQUEST } } },
        select: {
          artifacts: { where: { type: ArtifactType.PULL_REQUEST }, select: { content: true } },
        },
      },
    },
  });

  if (tasks.length === 0) {
    return { workspaceId: workspace.id, slug: workspace.slug, linked: 0, pending: 0, capped: false };
  }

  const state = parseState(workspace.jarvisSyncState);
  const sinceSec = readHighWaterSec(state);
  const { nodes, newestSec } = await fetchPrNodesSince(config, sinceSec);
  const prMap = buildPrMap(nodes);

  const edges: ReturnType<typeof taskPrEdge>[] = [];
  const linkedTaskIds: string[] = [];
  let pending = 0;

  for (const task of tasks) {
    const refs = taskPrRefs(task);

    // No usable PR URL on the artifact(s): nothing to ever resolve — mark linked
    // so it stops consuming a scan slot every run.
    if (refs.length === 0) {
      linkedTaskIds.push(task.id);
      continue;
    }

    const refIds = refs.map((r) => prMap.get(prNodeKey(r.repo, r.number)));
    if (refIds.some((id) => !id)) {
      // At least one PR not ingested yet — retry next run, don't mark.
      pending++;
      continue;
    }

    for (const refId of refIds) edges.push(taskPrEdge(task.id, task.title, refId!));
    linkedTaskIds.push(task.id);
  }

  for (const part of chunk(edges, BULK_CHUNK)) {
    const res = await addEdgeBulk(config, part);
    if (!res.success) errors.push(...res.errors);
  }

  if (linkedTaskIds.length > 0) {
    await db.task.updateMany({
      where: { id: { in: linkedTaskIds } },
      data: { jarvisPrLinkedAt: new Date() },
    });
  }

  // Capped only when we hit the batch limit AND made progress, so a batch of
  // perpetually-pending tasks can't trigger runaway self-chaining.
  const linked = linkedTaskIds.length;
  const capped = tasks.length === maxPerRun && linked > 0;

  // Advance the high-water only on a fully-drained pass (see file header).
  if (!capped && newestSec > sinceSec) {
    state.prLink = { highWater: new Date(newestSec * 1000).toISOString() };
    await db.workspace.update({
      where: { id: workspace.id },
      data: { jarvisSyncState: state as object },
    });
  }

  return { workspaceId: workspace.id, slug: workspace.slug, linked, pending, capped, errors };
}

/**
 * One PR-link pass across all workspaces that have a swarm configured.
 * Returns `anyCapped` so the caller can self-chain to drain a backlog.
 */
export async function runJarvisPrLink(
  opts: { maxPerRun?: number } = {},
): Promise<PrLinkRunResult> {
  const maxPerRun = opts.maxPerRun ?? DEFAULT_MAX_PER_RUN;

  if (process.env.USE_MOCKS === "true") {
    logger.info("[JARVIS PR LINK] USE_MOCKS enabled, skipping", LOG);
    return { processed: 0, anyCapped: false, results: [] };
  }

  const workspaces = await db.workspace.findMany({
    where: { deleted: false, swarm: { isNot: null } },
    select: { id: true, slug: true, jarvisSyncState: true },
  });

  logger.info(`[JARVIS PR LINK] Starting for ${workspaces.length} workspaces`, LOG);

  const results: WorkspacePrLinkResult[] = [];
  let anyCapped = false;

  for (const ws of workspaces) {
    try {
      const config = await getJarvisConfigForWorkspace(ws.id);
      if (!config) {
        results.push({ workspaceId: ws.id, slug: ws.slug, skipped: "no jarvis config" });
        continue;
      }

      const result = await linkWorkspace(ws, config, maxPerRun);
      if (result.capped) anyCapped = true;
      if (result.errors && result.errors.length > 0) {
        logger.warn(`[JARVIS PR LINK] ${ws.slug}: ${result.errors.length} edge errors`, LOG, {
          errors: result.errors.slice(0, 5),
        });
      }
      results.push(result);
    } catch (error) {
      logger.error(`[JARVIS PR LINK] Failed for workspace ${ws.slug}`, LOG, { error });
      results.push({
        workspaceId: ws.id,
        slug: ws.slug,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  logger.info(`[JARVIS PR LINK] Done. processed=${workspaces.length} anyCapped=${anyCapped}`, LOG);

  return { processed: workspaces.length, anyCapped, results };
}
