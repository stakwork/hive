/**
 * System Map — the strut workflows behind the "Run" buttons on
 * `/w/<slug>/system-map`, one per tab (`SYSTEM_MAP_WORKFLOWS`):
 *
 *   schema       `swarm-systemmap-schema-sync`         kind `system_map`
 *                verifies the Sys* ontology against the workspace graph
 *   materialize  `swarm-systemmap-graph-materialize`   kind `system_map_materialize`
 *                writes the real system nodes and edges into the graph
 *   cwe_check    `swarm-systemmap-cwe-check-templates` kind `system_map_cwe_check`
 *                writes the `infosec` namespace's security graph
 *   cloud_links  `systemmap-cloud-links`               kind `system_map_cloud_links`
 *   security_review `swarm-cwe-security-review`        kind `system_map_security_review`
 *
 * All are authored in the org strut view (`/org/<login>/strut`), so the
 * launch targets that strut (`purpose: "system_map"` → the org default
 * swarm). Their subject is the WORKSPACE's swarm — not necessarily the one
 * strut runs on — as their `validate` step reads it:
 *
 *   input.swarm_url            the workspace swarm's stakgraph base (`https://x:3355`)
 *   input.swarm_secret_alias   the swarm's secret alias (`Swarm.swarmSecretAlias`),
 *                              the same reference the janitor / task workflows
 *                              hand Stakwork under this name. An alias, never
 *                              the key: `input` is persisted by strut on
 *                              `run.start` and kept on the row.
 *
 * There is nothing to deliver on completion: the `StrutRun` row IS the
 * result (`output`, `error`, `durationMs`), and the page reads it back
 * through `listSystemMapRuns`. That list also settles a PENDING row from
 * strut's run summary when the `run.end` callback has not landed — a hive
 * the swarm cannot reach (local dev behind NAT) — so the page shows the
 * result with or without callbacks. Missing / stale runs are left to the
 * `strut-runs-reconcile` cron, which owns the LOST verdict.
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { strutRunDeepLink, strutViewPath } from "@/lib/utils/strut-links";
import {
  completeStrutRun,
  dispatchStrutRun,
  probeStrutRun,
  STRUT_RUN_LOG_TAG,
  StrutDispatchError,
  type DispatchStrutRunResult,
  type StrutRunHandler,
  type StrutRunRow,
} from "@/services/strut-runs";
import type { SystemMapRun } from "@/types/system-map";

/** The workflows the page can run, keyed by tab. Names as published in the org strut view. */
export const SYSTEM_MAP_WORKFLOWS = {
  schema: { kind: "system_map", workflow: "swarm-systemmap-schema-sync", label: "Schema sync" },
  materialize: { kind: "system_map_materialize", workflow: "swarm-systemmap-graph-materialize", label: "Graph materialize" },
  cwe_check: { kind: "system_map_cwe_check", workflow: "swarm-systemmap-cwe-check-templates", label: "CWE check" },
  cloud_links: { kind: "system_map_cloud_links", workflow: "systemmap-cloud-links", label: "Cloud links" },
  security_review: { kind: "system_map_security_review", workflow: "swarm-cwe-security-review", label: "CWE security review" },
} as const;
export type SystemMapWorkflowKey = keyof typeof SYSTEM_MAP_WORKFLOWS;

/**
 * The workflows a run can be scoped to some CWEs, and how each takes them
 * (both optional — absent means every CWE):
 *   cwe_check        `cwe_ids: ["CWE-79", "CWE-89"]`, up to 50
 *   security_review  `cwe_id: "CWE-79"`, exactly one
 */
export const CWE_SCOPED_WORKFLOWS: Partial<Record<SystemMapWorkflowKey, { max: number }>> = {
  cwe_check: { max: 50 },
  security_review: { max: 1 },
};
const CWE_ID_RE = /^CWE-\d{1,5}$/;

/**
 * A request's `cweIds` for workflow `key`: undefined when absent, the
 * deduplicated ids when valid, or an error message when the workflow takes
 * no CWEs, an id is not `CWE-<n>`, or there are too many.
 */
export function parseCweIds(key: SystemMapWorkflowKey, value: unknown): string[] | undefined | { error: string } {
  if (value === undefined) return undefined;
  const scope = CWE_SCOPED_WORKFLOWS[key];
  if (!scope) return { error: "This workflow does not take cweIds" };
  if (!Array.isArray(value) || !value.every((id): id is string => typeof id === "string" && CWE_ID_RE.test(id))) {
    return { error: 'cweIds must be ids like "CWE-79"' };
  }
  const ids = [...new Set(value)];
  if (ids.length === 0 || ids.length > scope.max) {
    return { error: scope.max === 1 ? "This workflow takes exactly one CWE" : `cweIds must hold 1–${scope.max} ids` };
  }
  return ids;
}

/** The workflow input fields for `cweIds`: `cwe_id` for a one-CWE workflow, `cwe_ids` otherwise. */
function cweInput(key: SystemMapWorkflowKey, cweIds: string[] | undefined): Record<string, unknown> {
  if (!cweIds?.length) return {};
  return CWE_SCOPED_WORKFLOWS[key]?.max === 1 ? { cwe_id: cweIds[0] } : { cwe_ids: cweIds };
}

function cweIdsFromInput(input: unknown): string[] | null {
  if (!input || typeof input !== "object") return null;
  const { cwe_ids: ids, cwe_id: id } = input as { cwe_ids?: unknown; cwe_id?: unknown };
  if (Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === "string")) return ids as string[];
  return typeof id === "string" && id ? [id] : null;
}

export function isSystemMapWorkflowKey(value: unknown): value is SystemMapWorkflowKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SYSTEM_MAP_WORKFLOWS, value);
}

/** Every kind the page owns — the completion handler is shared. */
export const SYSTEM_MAP_KINDS = Object.values(SYSTEM_MAP_WORKFLOWS).map((w) => w.kind);

// Back-compat names for the first workflow.
export const SYSTEM_MAP_KIND = SYSTEM_MAP_WORKFLOWS.schema.kind;
export const SYSTEM_MAP_WORKFLOW = SYSTEM_MAP_WORKFLOWS.schema.workflow;
/** How many runs the page lists. */
const LIST_LIMIT = 20;
/** A PENDING row younger than this is not probed — its callback is on the way. */
const PROBE_MIN_AGE_MS = 15_000;

/** The `StrutRunHandler` for `system_map`: the row is the delivery. */
export const handleSystemMapSettled: StrutRunHandler = async (row) => {
  logger.info("System map run settled", STRUT_RUN_LOG_TAG, {
    runId: row.id,
    workspaceId: row.workspaceId,
    status: row.status,
  });
};

const ROW_SELECT = {
  id: true,
  workspaceId: true,
  swarmId: true,
  userId: true,
  kind: true,
  workflow: true,
  strutRunId: true,
  status: true,
  input: true,
  output: true,
  error: true,
  durationMs: true,
  conversationId: true,
  proposalId: true,
  jobId: true,
  createdAt: true,
  settledAt: true,
} as const;

export function serializeSystemMapRun(row: StrutRunRow, orgGithubLogin: string | null): SystemMapRun {
  return {
    id: row.id,
    workflow: row.workflow,
    strutRunId: row.strutRunId,
    status: row.status,
    output: row.output ?? null,
    error: row.error,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
    strutUrl:
      orgGithubLogin && row.strutRunId
        ? strutViewPath(orgGithubLogin, strutRunDeepLink(row.workflow, row.strutRunId))
        : null,
    cweIds: cweIdsFromInput(row.input),
  };
}

async function orgLoginFor(workspaceId: string): Promise<string | null> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { sourceControlOrg: { select: { githubLogin: true } } },
  });
  return ws?.sourceControlOrg?.githubLogin ?? null;
}

/**
 * Settle a PENDING row from strut's summary when the run is over there but
 * no callback reached us. Returns the row to show (re-read when settled).
 */
async function settleFromStrut(row: StrutRunRow, now: Date): Promise<StrutRunRow> {
  if (row.status !== StrutRunStatus.PENDING || !row.strutRunId) return row;
  if (now.getTime() - row.createdAt.getTime() < PROBE_MIN_AGE_MS) return row;
  const probe = await probeStrutRun(row);
  if (probe.kind !== "settled") return row;
  const full = await db.strutRun.findUnique({ where: { id: row.id }, select: { id: true, tokenHash: true } });
  if (!full) return row;
  await completeStrutRun(full, probe.completion);
  const settled = await db.strutRun.findUnique({ where: { id: row.id }, select: ROW_SELECT });
  return settled ?? row;
}

/** The workspace's runs of one workflow, newest first, PENDING ones settled from strut when they are over. */
export async function listSystemMapRuns(
  workspaceId: string,
  key: SystemMapWorkflowKey = "schema",
  opts: { now?: Date; limit?: number } = {},
): Promise<SystemMapRun[]> {
  const now = opts.now ?? new Date();
  const [rows, orgLogin] = await Promise.all([
    db.strutRun.findMany({
      where: { workspaceId, kind: SYSTEM_MAP_WORKFLOWS[key].kind },
      select: ROW_SELECT,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? LIST_LIMIT,
    }),
    orgLoginFor(workspaceId),
  ]);
  const shown: StrutRunRow[] = [];
  for (const row of rows) {
    try {
      shown.push(await settleFromStrut(row, now));
    } catch (err) {
      logger.warn("System map run probe failed (showing as pending)", STRUT_RUN_LOG_TAG, {
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
      shown.push(row);
    }
  }
  return shown.map((row) => serializeSystemMapRun(row, orgLogin));
}

/** Is a run of this workflow already in flight for the workspace? (One at a time, per workflow.) */
export async function hasPendingSystemMapRun(workspaceId: string, key: SystemMapWorkflowKey = "schema"): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: { workspaceId, kind: SYSTEM_MAP_WORKFLOWS[key].kind, status: StrutRunStatus.PENDING },
    select: { id: true },
  });
  return row !== null;
}

export interface LaunchSystemMapRunArgs {
  workspaceId: string;
  workspaceSlug: string;
  userId: string;
  /** Swarm-reachable base URL of this hive (the callback host). */
  publicBaseUrl: string;
  /** Which workflow; defaults to the schema sync. */
  key?: SystemMapWorkflowKey;
  /** Scope a CWE workflow (`CWE_SCOPED_WORKFLOWS`) to these CWEs; validate with `parseCweIds`. */
  cweIds?: string[];
}

/**
 * Launch the workflow for the workspace's swarm. Throws `StrutDispatchError`
 * when the workspace has no swarm URL or secret alias (`no_target`) or
 * nothing is running on strut's side.
 */
export async function launchSystemMapRun(args: LaunchSystemMapRunArgs): Promise<DispatchStrutRunResult> {
  const workspace = await db.workspace.findUnique({
    where: { id: args.workspaceId },
    select: { swarm: { select: { swarmUrl: true, swarmSecretAlias: true } } },
  });
  const swarm = workspace?.swarm;
  if (!swarm?.swarmUrl || !swarm.swarmSecretAlias) {
    throw new StrutDispatchError("no_target", "This workspace has no swarm URL or secret alias to map.");
  }
  const { kind, workflow } = SYSTEM_MAP_WORKFLOWS[args.key ?? "schema"];
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind,
    workflow,
    purpose: "system_map",
    input: {
      workspace: args.workspaceSlug,
      swarm_url: transformSwarmUrlToRepo2Graph(swarm.swarmUrl),
      swarm_secret_alias: swarm.swarmSecretAlias,
      ...cweInput(args.key ?? "schema", args.cweIds),
    },
    publicBaseUrl: args.publicBaseUrl,
  });
}
