/**
 * Feature→Concept edge bridge.
 *
 * Deterministically links a Hive `pg:feature` node to its corresponding
 * `kg:concept` nodes in the swarm code graph. The join is a two-hop fact:
 *   Feature → PR artifacts → stakgraph :3355 /gitree/prs/:prNumber → Concepts
 *
 * No agent inference; every edge is derived from an existing PR artifact.
 */

import { db } from "@/lib/db";
import { ArtifactType } from "@prisma/client";
import type { PullRequestContent } from "@/lib/chat";
import { parsePRUrl } from "@/lib/github/pr-monitor";
import { formatUrn } from "@/lib/urn/parse";
import { upsertEdge } from "@/lib/urn/edges";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StakgraphConcept {
  id: string;
  name: string;
  ref_id?: string;
  description: string;
}

export interface FeatureConceptResult {
  edgesUpserted: number;
  skipped: number;
  skippedNoRefId: number;
}

export interface BackfillResult {
  featuresProcessed: number;
  edgesUpserted: number;
  skipped: number;
  skippedNoRefId: number;
  /**
   * Keyset cursor: the id of the last feature processed in this batch. Pass it
   * back as `cursor` to resume after it. `null` when the run reached the end.
   */
  nextCursor: string | null;
  /** True when more features remain beyond this batch (call again with `nextCursor`). */
  hasMore: boolean;
}

const ZERO_RESULT: FeatureConceptResult = {
  edgesUpserted: 0,
  skipped: 0,
  skippedNoRefId: 0,
};

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Link a single feature to all KG concept nodes it implements, based on its
 * PR artifacts. Idempotent — safe to call multiple times for the same feature.
 */
export async function linkFeatureToConcepts(
  featureId: string,
): Promise<FeatureConceptResult> {
  // 1. Load feature + workspace + org
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      workspace: {
        select: {
          id: true,
          slug: true,
          sourceControlOrg: {
            select: {
              id: true,
              githubLogin: true,
            },
          },
        },
      },
    },
  });

  if (!feature?.workspace?.sourceControlOrg) {
    console.info("[FeatureConceptBridge] no org linked to workspace, skipping", {
      featureId,
    });
    return { ...ZERO_RESULT };
  }

  const { id: workspaceId, slug: workspaceSlug, sourceControlOrg } = feature.workspace;
  const { id: orgId, githubLogin: orgLogin } = sourceControlOrg;

  // 2. Verify active swarm exists
  const swarmResult = await getSwarmAccessByWorkspaceId(workspaceId);
  if (!swarmResult.success) {
    console.info("[FeatureConceptBridge] no active swarm for workspace", {
      featureId,
      workspaceId,
    });
    return { ...ZERO_RESULT };
  }

  const { swarmUrl, swarmApiKey } = swarmResult.data;

  // 3. Collect all PULL_REQUEST artifacts for this feature's tasks
  const artifacts = await db.artifact.findMany({
    where: {
      type: ArtifactType.PULL_REQUEST,
      message: {
        task: {
          featureId,
          deleted: false,
        },
      },
    },
    select: { content: true },
  });

  // Parse and deduplicate PR references
  const prMap = new Map<
    string,
    { owner: string; repo: string; prNumber: number }
  >();

  for (const artifact of artifacts) {
    const content = artifact.content as unknown as PullRequestContent;
    if (!content?.url) continue;
    const parsed = parsePRUrl(content.url);
    if (!parsed) continue;
    const key = `${parsed.owner}/${parsed.repo}#${parsed.prNumber}`;
    if (!prMap.has(key)) {
      prMap.set(key, parsed);
    }
  }

  if (prMap.size === 0) {
    return { ...ZERO_RESULT };
  }

  // 4. Build feature URN
  const featureUrn = formatUrn({
    realm: "pg",
    org: orgLogin,
    type: "feature",
    id: featureId,
  });

  let edgesUpserted = 0;
  let skipped = 0;
  let skippedNoRefId = 0;

  // 5. For each unique PR, fetch concepts from stakgraph
  for (const { owner, repo, prNumber } of prMap.values()) {
    const repoParam = encodeURIComponent(`${owner}/${repo}`);
    const url = `${swarmUrl}/gitree/prs/${prNumber}?repo=${repoParam}`;

    let concepts: StakgraphConcept[];
    try {
      const response = await fetch(url, {
        headers: { "x-api-token": swarmApiKey },
      });

      if (response.status === 404) {
        console.info("[FeatureConceptBridge] stakgraph 404 for PR", {
          featureId,
          prNumber,
          repo: `${owner}/${repo}`,
        });
        skipped++;
        continue;
      }

      if (!response.ok) {
        console.error("[FeatureConceptBridge] stakgraph error", {
          featureId,
          prNumber,
          repo: `${owner}/${repo}`,
          status: response.status,
        });
        skipped++;
        continue;
      }

      const body = (await response.json()) as { concepts?: StakgraphConcept[] };
      concepts = body.concepts ?? [];
    } catch (err) {
      console.error("[FeatureConceptBridge] fetch failed", {
        featureId,
        prNumber,
        repo: `${owner}/${repo}`,
        err,
      });
      skipped++;
      continue;
    }

    // 6. For each concept, upsert a UrnEdge
    for (const concept of concepts) {
      if (!concept.ref_id) {
        console.info("[FeatureConceptBridge] concept missing ref_id", {
          featureId,
          conceptId: concept.id,
        });
        skippedNoRefId++;
        continue;
      }

      const conceptUrn = formatUrn({
        realm: "kg",
        org: orgLogin,
        workspace: workspaceSlug,
        type: "concept",
        id: concept.ref_id,
      });

      await upsertEdge(orgId, featureUrn, conceptUrn, "implemented-by");
      edgesUpserted++;
    }
  }

  return { edgesUpserted, skipped, skippedNoRefId };
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 500;
const DEFAULT_BUDGET_MS = 120_000;

/**
 * Backfill Feature→Concept edges for features in an org (optionally scoped to a
 * single workspace).
 *
 * RESUMABLE & BOUNDED. Each call processes at most `batchSize` features and runs
 * for at most `budgetMs`, then returns a keyset `cursor`. This is what keeps the
 * job under a serverless function timeout: instead of one unbounded loop over
 * thousands of features (which gets killed mid-way by FUNCTION_INVOCATION_TIMEOUT
 * and never reaches the tail), the caller drives it in safe chunks, passing the
 * returned `nextCursor` back until `hasMore` is false.
 *
 * Features are walked in a stable `id asc` keyset order so progress is monotonic
 * — every call advances past the previous cursor regardless of whether edges were
 * produced (features with no PRs / no concepts won't be re-processed on resume).
 * Idempotent — safe to re-run or overlap.
 */
export async function backfillFeatureConceptEdges({
  orgId,
  workspaceId,
  cursor,
  batchSize = DEFAULT_BATCH_SIZE,
  budgetMs = DEFAULT_BUDGET_MS,
}: {
  orgId: string;
  workspaceId?: string;
  /** Resume after this feature id (exclusive). Omit to start from the beginning. */
  cursor?: string;
  /** Max features to process this call. Clamped to [1, 500]. */
  batchSize?: number;
  /** Soft wall-clock budget; stop early (with a resumable cursor) once exceeded. */
  budgetMs?: number;
}): Promise<BackfillResult> {
  const take = Math.min(Math.max(Math.trunc(batchSize), 1), MAX_BATCH_SIZE);
  const start = Date.now();

  // Fetch one extra row to detect whether more remain past this batch.
  const rows = await db.feature.findMany({
    where: {
      deleted: false,
      workspace: {
        sourceControlOrgId: orgId,
        ...(workspaceId ? { id: workspaceId } : {}),
      },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: take + 1,
  });

  const moreBeyondBatch = rows.length > take;
  const batch = moreBeyondBatch ? rows.slice(0, take) : rows;

  let featuresProcessed = 0;
  let edgesUpserted = 0;
  let skipped = 0;
  let skippedNoRefId = 0;
  let lastProcessedId: string | null = null;
  let stoppedEarly = false;

  for (const feature of batch) {
    // Stop before the function times out; the cursor lets the caller resume.
    if (Date.now() - start > budgetMs) {
      stoppedEarly = true;
      break;
    }
    try {
      const result = await linkFeatureToConcepts(feature.id);
      featuresProcessed++;
      edgesUpserted += result.edgesUpserted;
      skipped += result.skipped;
      skippedNoRefId += result.skippedNoRefId;
    } catch (err) {
      console.error("[FeatureConceptBridge] backfill: feature failed", {
        featureId: feature.id,
        err,
      });
      skipped++;
    }
    lastProcessedId = feature.id;
  }

  // More work remains if we cut the batch short, or there were rows past it.
  const hasMore = stoppedEarly || moreBeyondBatch;
  // Resume after the last id we actually processed. If we processed nothing this
  // call (e.g. budget already exceeded), keep the incoming cursor so the caller
  // doesn't skip unprocessed features.
  const nextCursor = hasMore ? (lastProcessedId ?? cursor ?? null) : null;

  console.info("[FeatureConceptBridge] backfill batch complete", {
    orgId,
    workspaceId,
    featuresProcessed,
    edgesUpserted,
    skipped,
    skippedNoRefId,
    hasMore,
    nextCursor,
    elapsedMs: Date.now() - start,
  });

  return {
    featuresProcessed,
    edgesUpserted,
    skipped,
    skippedNoRefId,
    nextCursor,
    hasMore,
  };
}
