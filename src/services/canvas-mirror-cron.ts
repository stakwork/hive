/**
 * Canvas-mirror cron.
 *
 * Periodically mirrors org-scoped canvas planning entities (Initiatives,
 * Milestones, Research, and canvas Notes/Decisions) from Postgres into each
 * org's home swarm's Jarvis knowledge graph. Sibling to `jarvis-mirror-cron`.
 *
 * Design:
 *  - Per-org keyset cursor `(updatedAt, id)` stored in
 *    `SourceControlOrg.jarvisSyncState`. Canvas notes/decisions use a
 *    per-canvas `updatedAt` watermark (any canvas edit re-scans that canvas).
 *  - Home swarm resolved via `SourceControlOrg.defaultWorkspaceId → Workspace
 *    → Swarm`. Orgs without a default workspace or swarm are skipped silently.
 *  - Bounded work per run (`maxPerType`), chunked bulk HTTP calls (`BULK_CHUNK`).
 *  - Best-effort: a failure for one org never aborts others; cursors only advance
 *    on a successful push so skipped rows are retried on the next run.
 *  - Cross-swarm links: Initiative→Feature and Milestone→Feature are recorded as
 *    `UrnEdge` rows (NOT graph edges) so features in other workspaces are reachable.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getDefaultWorkspaceForOrg } from "@/lib/helpers/org-workspace";
import { addNodeBulk, addEdgeBulk } from "@/services/swarm/api/nodes";
import { upsertEdge } from "@/lib/urn/edges";
import { formatUrn } from "@/lib/urn/parse";
import { extractCanvasNoteNodes } from "@/services/canvas-mirror/extract-canvas-nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import {
  initiativeToNode,
  milestoneToNode,
  researchToNode,
  noteToNode,
  decisionToNode,
  initiativeMilestoneEdge,
  initiativeResearchEdge,
  type JarvisNodePayload,
  type JarvisEdgePayload,
  type InitiativeRow,
  type MilestoneRow,
  type ResearchRow,
} from "@/services/jarvis-mirror/mappers";

const LOG = "CANVAS_MIRROR";

export const DEFAULT_MAX_PER_TYPE = 500;
export const BULK_CHUNK = 100;

// Per-org wall-clock budget. Mirrors the jarvis-mirror-cron design: a slow or
// unreachable swarm cannot dominate the run budget across all orgs.
export const ORG_BUDGET_MS = 60_000;

type OrgEntityType = "initiative" | "milestone" | "research" | "canvas";

interface Cursor {
  at: string; // ISO updatedAt of last processed row
  id: string; // id of last processed row (keyset tie-breaker)
}

// Canvas watermarks are stored as `canvas:{orgId}:{ref}` → ISO string
type SyncState = Partial<Record<OrgEntityType, Cursor>> & Record<string, string | Cursor>;

export interface OrgMirrorResult {
  orgId: string;
  githubLogin: string;
  skipped?: string;
  counts?: Record<OrgEntityType, number>;
  capped?: boolean;
  errors?: string[];
}

export interface CanvasMirrorRunResult {
  processed: number;
  anyCapped: boolean;
  results: OrgMirrorResult[];
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

class EndpointMissingError extends Error {
  constructor() {
    super("jarvis bulk endpoint not found (404)");
    this.name = "EndpointMissingError";
  }
}

async function pushNodes(
  config: JarvisConnectionConfig,
  nodes: JarvisNodePayload[],
  errors: string[],
): Promise<boolean> {
  let ok = true;
  for (const part of chunk(nodes, BULK_CHUNK)) {
    const res = await addNodeBulk(config, part, { reprocess: true });
    if (res.endpointMissing) throw new EndpointMissingError();
    if (!res.success) {
      ok = false;
      errors.push(...res.errors);
    }
  }
  return ok;
}

async function pushEdges(
  config: JarvisConnectionConfig,
  edges: JarvisEdgePayload[],
  errors: string[],
): Promise<boolean> {
  let ok = true;
  for (const part of chunk(edges, BULK_CHUNK)) {
    const res = await addEdgeBulk(config, part);
    if (res.endpointMissing) throw new EndpointMissingError();
    if (!res.success) {
      ok = false;
      errors.push(...res.errors);
    }
  }
  return ok;
}

/** Mirror a single org. Mutates `state` in place with advanced cursors. */
async function mirrorOrg(
  org: { id: string; githubLogin: string },
  workspaceId: string,
  config: JarvisConnectionConfig,
  state: SyncState,
  maxPerType: number,
): Promise<OrgMirrorResult> {
  const errors: string[] = [];
  const counts: Record<OrgEntityType, number> = {
    initiative: 0,
    milestone: 0,
    research: 0,
    canvas: 0,
  };
  let capped = false;
  const orgLogin = org.githubLogin;

  const deadline = Date.now() + ORG_BUDGET_MS;
  const overBudget = () => Date.now() >= deadline;

  // -------------------------------------------------------------------------
  // Initiatives
  // -------------------------------------------------------------------------
  const initiatives = await db.initiative.findMany({
    where: { orgId: org.id, ...keysetWhere(state.initiative as Cursor | undefined) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: maxPerType,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      orgId: true,
      assigneeId: true,
      startDate: true,
      targetDate: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (initiatives.length > 0) {
    const nodes = initiatives.map((i) => initiativeToNode(i as InitiativeRow));
    const ok = await pushNodes(config, nodes, errors);
    if (ok) {
      const last = initiatives[initiatives.length - 1];
      state.initiative = { at: last.updatedAt.toISOString(), id: last.id } as Cursor;
      counts.initiative = initiatives.length;
      if (initiatives.length === maxPerType) capped = true;
    }
  }

  if (overBudget()) return { orgId: org.id, githubLogin: orgLogin, counts, capped, errors };

  // -------------------------------------------------------------------------
  // Milestones — scoped via Initiative.orgId (no direct orgId on Milestone)
  // -------------------------------------------------------------------------
  const milestones = await db.milestone.findMany({
    where: {
      initiative: { orgId: org.id },
      ...keysetWhere(state.milestone as Cursor | undefined),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: maxPerType,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      sequence: true,
      initiativeId: true,
      assigneeId: true,
      dueDate: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      initiative: { select: { id: true, name: true } },
    },
  });

  if (milestones.length > 0) {
    const nodes = milestones.map((m) => milestoneToNode(m as MilestoneRow));
    const inGraphEdges: JarvisEdgePayload[] = milestones.map((m) =>
      initiativeMilestoneEdge(
        { id: m.initiative.id, name: m.initiative.name },
        { id: m.id, name: m.name },
      ),
    );
    const nodesOk = await pushNodes(config, nodes, errors);
    const edgesOk = await pushEdges(config, inGraphEdges, errors);
    if (nodesOk && edgesOk) {
      const last = milestones[milestones.length - 1];
      state.milestone = { at: last.updatedAt.toISOString(), id: last.id } as Cursor;
      counts.milestone = milestones.length;
      if (milestones.length === maxPerType) capped = true;
    }
  }

  if (overBudget()) return { orgId: org.id, githubLogin: orgLogin, counts, capped, errors };

  // -------------------------------------------------------------------------
  // Research
  // -------------------------------------------------------------------------
  const researches = await db.research.findMany({
    where: { orgId: org.id, ...keysetWhere(state.research as Cursor | undefined) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: maxPerType,
    select: {
      id: true,
      slug: true,
      topic: true,
      title: true,
      summary: true,
      content: true,
      orgId: true,
      initiativeId: true,
      createdAt: true,
      updatedAt: true,
      initiative: { select: { id: true, name: true } },
    },
  });

  if (researches.length > 0) {
    const nodes = researches.map((r) => researchToNode(r as ResearchRow));
    const inGraphEdges: JarvisEdgePayload[] = researches
      .filter((r) => r.initiative !== null)
      .map((r) =>
        initiativeResearchEdge(
          { id: r.initiative!.id, name: r.initiative!.name },
          { id: r.id, title: r.title, slug: r.slug },
        ),
      );
    const nodesOk = await pushNodes(config, nodes, errors);
    const edgesOk =
      inGraphEdges.length > 0 ? await pushEdges(config, inGraphEdges, errors) : true;
    if (nodesOk && edgesOk) {
      const last = researches[researches.length - 1];
      state.research = { at: last.updatedAt.toISOString(), id: last.id } as Cursor;
      counts.research = researches.length;
      if (researches.length === maxPerType) capped = true;
    }
  }

  if (overBudget()) return { orgId: org.id, githubLogin: orgLogin, counts, capped, errors };

  // -------------------------------------------------------------------------
  // Notes & Decisions — extracted from Canvas JSON blobs
  // Per-canvas watermark: only re-scan a canvas when updatedAt changed.
  // -------------------------------------------------------------------------
  const canvases = await db.canvas.findMany({
    where: { orgId: org.id },
    select: { ref: true, data: true, updatedAt: true },
  });

  let canvasNodeCount = 0;
  for (const canvas of canvases) {
    const watermarkKey = `canvas:${org.id}:${canvas.ref}`;
    const storedWatermark = state[watermarkKey];
    const storedAt =
      typeof storedWatermark === "string"
        ? storedWatermark
        : typeof storedWatermark === "object" && storedWatermark !== null
          ? (storedWatermark as Cursor).at
          : null;
    const canvasUpdatedAt = canvas.updatedAt.toISOString();

    // Skip canvas if nothing changed since last run.
    if (storedAt && storedAt >= canvasUpdatedAt) continue;

    const noteNodes = extractCanvasNoteNodes(canvas.data, canvas.ref);
    if (noteNodes.length === 0) {
      // Advance watermark even if no nodes — canvas was scanned but had none.
      state[watermarkKey] = canvasUpdatedAt;
      continue;
    }

    const notes = noteNodes.filter((n) => n.category === "note");
    const decisions = noteNodes.filter((n) => n.category === "decision");
    const nodePayloads: JarvisNodePayload[] = [
      ...notes.map(noteToNode),
      ...decisions.map(decisionToNode),
    ];

    const ok = await pushNodes(config, nodePayloads, errors);
    if (ok) {
      state[watermarkKey] = canvasUpdatedAt;
      canvasNodeCount += noteNodes.length;
    }
  }
  if (canvasNodeCount > 0) counts.canvas = canvasNodeCount;

  if (overBudget()) return { orgId: org.id, githubLogin: orgLogin, counts, capped, errors };

  // -------------------------------------------------------------------------
  // Cross-swarm UrnEdge links: Initiative → Feature, Milestone → Feature
  // These are Postgres UrnEdge rows (not graph edges) so features in other
  // workspaces' swarms remain reachable via the graph-walker.
  // -------------------------------------------------------------------------
  const initiativeFeatures = await db.feature.findMany({
    where: {
      initiativeId: { not: null },
      initiative: { orgId: org.id },
      deleted: false,
    },
    select: {
      id: true,
      initiativeId: true,
      workspace: { select: { slug: true } },
    },
  });

  for (const f of initiativeFeatures) {
    if (!f.initiativeId) continue;
    const fromUrn = formatUrn({ realm: "pg", org: orgLogin, type: "initiative", id: f.initiativeId });
    const toUrn = formatUrn({
      realm: "kg",
      org: orgLogin,
      workspace: f.workspace.slug,
      type: "HiveFeature",
      id: f.id,
    });
    try {
      await upsertEdge(org.id, fromUrn, toUrn, "has-feature");
    } catch (err) {
      errors.push(`urnEdge initiative→feature ${f.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const milestoneFeatures = await db.feature.findMany({
    where: {
      milestoneId: { not: null },
      milestone: { initiative: { orgId: org.id } },
      deleted: false,
    },
    select: {
      id: true,
      milestoneId: true,
      workspace: { select: { slug: true } },
    },
  });

  for (const f of milestoneFeatures) {
    if (!f.milestoneId) continue;
    const fromUrn = formatUrn({ realm: "pg", org: orgLogin, type: "milestone", id: f.milestoneId });
    const toUrn = formatUrn({
      realm: "kg",
      org: orgLogin,
      workspace: f.workspace.slug,
      type: "HiveFeature",
      id: f.id,
    });
    try {
      await upsertEdge(org.id, fromUrn, toUrn, "has-feature");
    } catch (err) {
      errors.push(`urnEdge milestone→feature ${f.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { orgId: org.id, githubLogin: orgLogin, counts, capped, errors };
}

/**
 * Run one canvas-mirror pass across all orgs that have a home swarm configured.
 * Returns `anyCapped` so the caller can self-chain to drain a backlog.
 */
export async function runCanvasMirror(
  opts: { maxPerType?: number } = {},
): Promise<CanvasMirrorRunResult> {
  const maxPerType = opts.maxPerType ?? DEFAULT_MAX_PER_TYPE;

  if (process.env.USE_MOCKS === "true") {
    logger.info("[CANVAS MIRROR] USE_MOCKS enabled, skipping", LOG);
    return { processed: 0, anyCapped: false, results: [] };
  }

  const orgs = await db.sourceControlOrg.findMany({
    select: {
      id: true,
      githubLogin: true,
      jarvisSyncState: true,
    },
  });

  logger.info(`[CANVAS MIRROR] Starting for ${orgs.length} orgs`, LOG);

  const results: OrgMirrorResult[] = [];
  let anyCapped = false;

  for (const org of orgs) {
    try {
      // Resolve home workspace (defaultWorkspaceId → Workspace with Swarm).
      const workspace = await getDefaultWorkspaceForOrg(org.id);
      if (!workspace) {
        logger.info(`[CANVAS MIRROR] ${org.githubLogin}: skipped (no default workspace or swarm)`, LOG);
        results.push({ orgId: org.id, githubLogin: org.githubLogin, skipped: "no default workspace or swarm" });
        continue;
      }

      const config = await getJarvisConfigForWorkspace(workspace.id);
      if (!config) {
        logger.info(`[CANVAS MIRROR] ${org.githubLogin}: skipped (no jarvis config)`, LOG);
        results.push({ orgId: org.id, githubLogin: org.githubLogin, skipped: "no jarvis config" });
        continue;
      }

      const state = parseState(org.jarvisSyncState);
      const result = await mirrorOrg(org, workspace.id, config, state, maxPerType);

      // Persist advanced cursors (best-effort, only when something moved).
      const c = result.counts ?? { initiative: 0, milestone: 0, research: 0, canvas: 0 };
      const totalMoved = c.initiative + c.milestone + c.research + c.canvas;
      // Also persist if any canvas watermarks were updated (state may have changed).
      // Always persist state to advance canvas watermarks even if node counts are 0.
      await db.sourceControlOrg.update({
        where: { id: org.id },
        data: { jarvisSyncState: state as object },
      });

      if (result.capped) anyCapped = true;
      if (result.errors && result.errors.length > 0) {
        logger.warn(`[CANVAS MIRROR] ${org.githubLogin}: ${result.errors.length} errors`, LOG, {
          errors: result.errors.slice(0, 5),
        });
      }
      logger.info(
        `[CANVAS MIRROR] ${org.githubLogin}: synced initiative=${c.initiative} milestone=${c.milestone} research=${c.research} canvas=${c.canvas}` +
          `${result.capped ? " (capped)" : ""}`,
        LOG,
      );
      results.push(result);
    } catch (error) {
      if (error instanceof EndpointMissingError) {
        logger.info(`[CANVAS MIRROR] ${org.githubLogin}: skipped (bulk endpoint missing, 404)`, LOG);
        results.push({ orgId: org.id, githubLogin: org.githubLogin, skipped: "jarvis bulk endpoint missing (404)" });
        continue;
      }
      logger.error(`[CANVAS MIRROR] Failed for org ${org.githubLogin}`, LOG, { error });
      results.push({
        orgId: org.id,
        githubLogin: org.githubLogin,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  logger.info(
    `[CANVAS MIRROR] Done. processed=${orgs.length} anyCapped=${anyCapped}`,
    LOG,
  );

  return { processed: orgs.length, anyCapped, results };
}
