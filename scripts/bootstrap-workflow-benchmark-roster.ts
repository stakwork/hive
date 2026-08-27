/**
 * scripts/bootstrap-workflow-benchmark-roster.ts
 *
 * Idempotent bootstrap script for the Workflow Editor Benchmark EvalSet +
 * EvalRequirement roster in the Jarvis knowledge graph.
 *
 * Run once out-of-band to prime the graph before any UI work, then re-run
 * whenever corpus criteria change. Also deletes orphaned requirements (criteria
 * removed from the corpus but still in the graph, which inflate the denominator).
 *
 * Usage:
 *   npx tsx scripts/bootstrap-workflow-benchmark-roster.ts
 *
 * Requires: NEXTAUTH_URL workspace slug environment pointing at a configured
 * workspace with Jarvis access. The script resolves Jarvis config via the
 * workspace slug env var BOOTSTRAP_WORKSPACE_SLUG (defaults to "stakwork").
 *
 * Never runs in production.
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { EncryptionService } from "../src/lib/encryption";
import { getJarvisUrl } from "../src/lib/utils/swarm";
import { WORKFLOW_BENCHMARK_TASKS, type WorkflowBenchmarkTask } from "../src/lib/workflow-benchmark-tasks";
import {
  ensureWorkflowBenchmarkEvalNodes,
  listEvalSetRequirementRefs,
  deleteOrphanedRequirement,
  readEvalSetNode,
} from "../src/lib/workflow-benchmarks/eval-nodes";
import type { JarvisConnectionConfig } from "../src/types/jarvis";

const prisma = new PrismaClient();

if (process.env.NODE_ENV === "production") {
  console.error("❌ This script must not run in production. Aborting.");
  process.exit(1);
}

const WORKSPACE_SLUG = process.env.BOOTSTRAP_WORKSPACE_SLUG ?? "stakwork";

async function resolveJarvisConfig(slug: string): Promise<JarvisConnectionConfig | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!workspace) {
    console.error(`❌ Workspace "${slug}" not found`);
    return null;
  }

  const swarm = await prisma.swarm.findFirst({
    where: { workspaceId: workspace.id },
    select: { name: true, swarmApiKey: true },
  });

  if (!swarm?.name || !swarm?.swarmApiKey) {
    console.error(`❌ No configured swarm for workspace "${slug}"`);
    return null;
  }

  const apiKey = EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey);
  return { jarvisUrl: getJarvisUrl(swarm.name), apiKey };
}

async function bootstrapTask(config: JarvisConnectionConfig, task: WorkflowBenchmarkTask): Promise<void> {
  console.log(`\n── Task: ${task.slug} ──`);

  // ── Upsert EvalSet + EvalRequirements ─────────────────────────────────────
  const refs = await ensureWorkflowBenchmarkEvalNodes(config, task);
  if (!refs) {
    console.error(`  ❌ Failed to upsert eval nodes for ${task.slug}`);
    return;
  }

  console.log(`  ✓ EvalSet ref_id: ${refs.evalSetRef}`);
  console.log(`  ✓ Upserted ${refs.requirementRefs.length} EvalRequirements`);

  // ── Verify write→read round-trip ──────────────────────────────────────────
  const evalSetNode = await readEvalSetNode(config, refs.evalSetRef);
  if (evalSetNode) {
    // The response from the Jarvis node endpoint may vary in shape
    const nodeAny = evalSetNode as Record<string, unknown>;
    const corpus = (nodeAny.properties as Record<string, unknown> | undefined)?.corpus
      ?? nodeAny.corpus;
    const id = (nodeAny.properties as Record<string, unknown> | undefined)?.id
      ?? nodeAny.id;
    console.log(`  ✓ Round-trip verify: id="${String(id)}" corpus="${String(corpus)}"`);
  } else {
    console.warn(`  ⚠ Could not verify EvalSet node (readNodeByRef returned null)`);
  }

  // ── Orphan reconciliation ─────────────────────────────────────────────────
  // List requirements currently in the graph and delete any whose namespaced
  // id is no longer in the corpus. This prevents stale requirements from
  // inflating the score denominator.
  const corpusIds = new Set(task.criteria.map((c) => `${task.slug}::${c.id}`));
  const graphReqs = await listEvalSetRequirementRefs(config, refs.evalSetRef);

  let orphanCount = 0;
  for (const req of graphReqs) {
    if (!corpusIds.has(req.id)) {
      console.log(`  ⚠ Orphaned requirement: id="${req.id}" ref_id=${req.ref_id} — deleting`);
      await deleteOrphanedRequirement(config, req.ref_id, req.id);
      orphanCount++;
    }
  }

  if (orphanCount === 0) {
    console.log(`  ✓ No orphaned requirements found`);
  } else {
    console.log(`  ✓ Deleted ${orphanCount} orphaned requirement(s)`);
  }

  // ── Roster size sanity check ──────────────────────────────────────────────
  const expectedCount = task.criteria.length;
  const graphCount = graphReqs.length - orphanCount;
  if (graphCount !== expectedCount && graphCount > 0) {
    console.warn(`  ⚠ Roster size mismatch after cleanup: graph=${graphCount} corpus=${expectedCount}`);
    console.warn(`    This may indicate a partial upsert. Re-run to fix.`);
  } else if (graphCount === expectedCount) {
    console.log(`  ✓ Roster size matches corpus: ${expectedCount} criteria`);
  }
}

async function main() {
  console.log(`Bootstrap: Workflow Editor Benchmark EvalSet roster`);
  console.log(`Workspace: ${WORKSPACE_SLUG}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`Tasks: ${WORKFLOW_BENCHMARK_TASKS.length}`);

  const config = await resolveJarvisConfig(WORKSPACE_SLUG);
  if (!config) {
    process.exit(1);
  }
  console.log(`Jarvis: ${config.jarvisUrl}`);

  for (const task of WORKFLOW_BENCHMARK_TASKS) {
    await bootstrapTask(config, task);
  }

  console.log("\n✓ Bootstrap complete");
}

main()
  .catch((err) => {
    console.error("Bootstrap failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
