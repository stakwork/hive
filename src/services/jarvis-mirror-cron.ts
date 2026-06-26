/**
 * Jarvis graph-mirror cron.
 *
 * Periodically mirrors Hive PM entities (Feature, Task, ChatMessage) from
 * Postgres into each workspace's Jarvis knowledge graph as HiveFeature /
 * HiveTask / HiveChatMessage nodes (+ HAS_TASK / HAS_MESSAGE edges).
 *
 * Design:
 *  - Per-workspace keyset cursor `(updatedAt, id)` per entity type, stored on
 *    `Workspace.jarvisSyncState`. Idempotent: node identity is the Postgres id
 *    (carried in the schema node_key), upserted via `reprocess: true`.
 *  - Bounded work per run (`maxPerType`), chunked bulk HTTP calls (`BULK_CHUNK`).
 *  - Best-effort: a failure for one workspace never aborts the others; graph
 *    writes are non-fatal. The route self-chains when a batch is capped so a
 *    backlog drains quickly.
 *  - Live rows only (skips soft-deleted / archived); chat excludes in-flight
 *    SENDING messages.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ChatStatus } from "@prisma/client";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { addNodeBulk, addEdgeBulk } from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import {
  featureToNode,
  taskToNode,
  chatMessageToNode,
  taskEdge,
  chatMessageEdge,
  type JarvisNodePayload,
  type JarvisEdgePayload,
} from "@/services/jarvis-mirror/mappers";

const LOG = "JARVIS_MIRROR";

export const DEFAULT_MAX_PER_TYPE = 500;
export const BULK_CHUNK = 100;

type EntityType = "feature" | "task" | "chat";

interface Cursor {
  at: string; // ISO updatedAt of last processed row
  id: string; // id of last processed row
}

type SyncState = Partial<Record<EntityType, Cursor>>;

export interface WorkspaceMirrorResult {
  workspaceId: string;
  slug: string;
  skipped?: string;
  counts?: Record<EntityType, number>;
  capped?: boolean;
  errors?: string[];
}

export interface MirrorRunResult {
  processed: number;
  anyCapped: boolean;
  results: WorkspaceMirrorResult[];
}

/** Build a Prisma keyset `where` fragment for `(updatedAt, id) > cursor`. */
function keysetWhere(cursor?: Cursor) {
  if (!cursor) return {};
  const at = new Date(cursor.at);
  return {
    OR: [
      { updatedAt: { gt: at } },
      { updatedAt: at, id: { gt: cursor.id } },
    ],
  };
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

async function pushNodes(
  config: JarvisConnectionConfig,
  nodes: JarvisNodePayload[],
  errors: string[],
): Promise<void> {
  for (const part of chunk(nodes, BULK_CHUNK)) {
    const res = await addNodeBulk(config, part, { reprocess: true });
    if (!res.success) errors.push(...res.errors);
  }
}

async function pushEdges(
  config: JarvisConnectionConfig,
  edges: JarvisEdgePayload[],
  errors: string[],
): Promise<void> {
  for (const part of chunk(edges, BULK_CHUNK)) {
    const res = await addEdgeBulk(config, part);
    if (!res.success) errors.push(...res.errors);
  }
}

/** Mirror a single workspace. Mutates `state` in place with advanced cursors. */
async function mirrorWorkspace(
  workspace: { id: string; slug: string },
  config: JarvisConnectionConfig,
  state: SyncState,
  maxPerType: number,
): Promise<WorkspaceMirrorResult> {
  const errors: string[] = [];
  const counts: Record<EntityType, number> = { feature: 0, task: 0, chat: 0 };
  let capped = false;

  // --- Features ---
  const features = await db.feature.findMany({
    where: { workspaceId: workspace.id, deleted: false, ...keysetWhere(state.feature) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: maxPerType,
  });
  if (features.length > 0) {
    await pushNodes(config, features.map(featureToNode), errors);
    const last = features[features.length - 1];
    state.feature = { at: last.updatedAt.toISOString(), id: last.id };
    counts.feature = features.length;
    if (features.length === maxPerType) capped = true;
  }

  // --- Tasks (+ HAS_TASK edges) ---
  const tasks = await db.task.findMany({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      archived: false,
      ...keysetWhere(state.task),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: maxPerType,
    include: { feature: { select: { id: true, title: true } } },
  });
  if (tasks.length > 0) {
    await pushNodes(config, tasks.map(taskToNode), errors);
    const edges = tasks.map(taskEdge).filter((e): e is JarvisEdgePayload => e !== null);
    await pushEdges(config, edges, errors);
    const last = tasks[tasks.length - 1];
    state.task = { at: last.updatedAt.toISOString(), id: last.id };
    counts.task = tasks.length;
    if (tasks.length === maxPerType) capped = true;
  }

  // --- Chat messages (+ HAS_MESSAGE edges) ---
  // No direct workspaceId on ChatMessage — reach it via task or feature.
  const messages = await db.chatMessage.findMany({
    where: {
      status: { not: ChatStatus.SENDING },
      OR: [
        { task: { workspaceId: workspace.id } },
        { feature: { workspaceId: workspace.id } },
      ],
      ...keysetWhere(state.chat),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: maxPerType,
    include: {
      task: { select: { id: true, title: true } },
      feature: { select: { id: true, title: true } },
    },
  });
  if (messages.length > 0) {
    await pushNodes(config, messages.map(chatMessageToNode), errors);
    const edges = messages
      .map(chatMessageEdge)
      .filter((e): e is JarvisEdgePayload => e !== null);
    await pushEdges(config, edges, errors);
    const last = messages[messages.length - 1];
    state.chat = { at: last.updatedAt.toISOString(), id: last.id };
    counts.chat = messages.length;
    if (messages.length === maxPerType) capped = true;
  }

  return { workspaceId: workspace.id, slug: workspace.slug, counts, capped, errors };
}

/**
 * Run one mirror pass across all workspaces that have a swarm configured.
 * Returns `anyCapped` so the caller can self-chain to drain a backlog.
 */
export async function runJarvisMirror(
  opts: { maxPerType?: number } = {},
): Promise<MirrorRunResult> {
  const maxPerType = opts.maxPerType ?? DEFAULT_MAX_PER_TYPE;

  if (process.env.USE_MOCKS === "true") {
    logger.info("[JARVIS MIRROR] USE_MOCKS enabled, skipping", LOG);
    return { processed: 0, anyCapped: false, results: [] };
  }

  const workspaces = await db.workspace.findMany({
    where: { deleted: false, swarm: { isNot: null } },
    select: { id: true, slug: true, jarvisSyncState: true },
  });

  logger.info(`[JARVIS MIRROR] Starting for ${workspaces.length} workspaces`, LOG);

  const results: WorkspaceMirrorResult[] = [];
  let anyCapped = false;

  for (const ws of workspaces) {
    try {
      const config = await getJarvisConfigForWorkspace(ws.id);
      if (!config) {
        results.push({ workspaceId: ws.id, slug: ws.slug, skipped: "no jarvis config" });
        continue;
      }

      const state = parseState(ws.jarvisSyncState);
      const result = await mirrorWorkspace(ws, config, state, maxPerType);

      // Persist advanced cursors (best-effort, only if something moved).
      if (result.counts && (result.counts.feature || result.counts.task || result.counts.chat)) {
        await db.workspace.update({
          where: { id: ws.id },
          data: { jarvisSyncState: state as object },
        });
      }

      if (result.capped) anyCapped = true;
      if (result.errors && result.errors.length > 0) {
        logger.warn(`[JARVIS MIRROR] ${ws.slug}: ${result.errors.length} graph errors`, LOG, {
          errors: result.errors.slice(0, 5),
        });
      }
      results.push(result);
    } catch (error) {
      logger.error(`[JARVIS MIRROR] Failed for workspace ${ws.slug}`, LOG, { error });
      results.push({
        workspaceId: ws.id,
        slug: ws.slug,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  logger.info(
    `[JARVIS MIRROR] Done. processed=${workspaces.length} anyCapped=${anyCapped}`,
    LOG,
  );

  return { processed: workspaces.length, anyCapped, results };
}
