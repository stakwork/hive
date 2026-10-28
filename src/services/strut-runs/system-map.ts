/**
 * System Map — the strut workflows behind the "Run" buttons on
 * `/w/<slug>/system-map`, one per tab (`SYSTEM_MAP_WORKFLOWS`):
 *
 *   system_map   `swarm-systemmap`                     kind `system_map`
 *                schema sync, graph materialize and cloud links in one run
 *                (they were three workflows; the `system_map_materialize` /
 *                `system_map_cloud_links` kinds survive only on old rows)
 *   cwe_check    `swarm-systemmap-cwe-check-templates` kind `system_map_cwe_check`
 *                writes the `infosec` namespace's security graph
 *                (it also does the security review, once `swarm-cwe-security-review`;
 *                its `system_map_security_review` kind survives only on old rows)
 *   finding_verify `finding-verify-pod-batch`          kind `system_map_finding_verify`
 *                checks some infosec `Finding`s on the workspace's pods; with
 *                `apply` it writes the verdict as `finding_status`
 *   security_audit `swarm-security-hunt`               kind `system_map_security_audit`
 *                audits repos by vulnerability class (`input.swarm` = the swarm
 *                id, `target_filter.repos`, `class_ids` / `classes`, `apply`, `max_agent_calls`);
 *                with `apply` it writes Findings, else a dry run
 *
 * All are authored in the org strut view (`/org/<login>/strut`), so the
 * launch targets that strut (`purpose: "system_map"` → the org default
 * swarm). Their subject is the WORKSPACE's swarm — not necessarily the one
 * strut runs on — as their `validate` step reads it:
 *
 *   input.workspace            the workspace slug — CWE workflows only
 *   input.workspace_id         the workspace id (whose pods have the repo) — finding check only
 *   input.finding_ref_ids      the `Finding` nodes' ref_ids — finding check only
 *   input.apply                write the verdict (else a dry run) — finding check only
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
import { getSecurityAuditClasses } from "@/lib/system-map/security-audit-classes";
import type { SystemMapRun } from "@/types/system-map";

/** The workflows the page can run, keyed by tab. Names as published in the org strut view. */
export const SYSTEM_MAP_WORKFLOWS = {
  system_map: { kind: "system_map", workflow: "swarm-systemmap", label: "System map" },
  cwe_check: { kind: "system_map_cwe_check", workflow: "swarm-systemmap-cwe-check-templates", label: "CWE check" },
  finding_verify: { kind: "system_map_finding_verify", workflow: "finding-verify-pod-batch", label: "Finding check" },
  package_cves: { kind: "system_map_package_cves", workflow: "swarm-package-cve-findings", label: "Package CVEs" },
  security_audit: { kind: "system_map_security_audit", workflow: "swarm-security-hunt", label: "Security audit" },
} as const;
export type SystemMapWorkflowKey = keyof typeof SYSTEM_MAP_WORKFLOWS;

/**
 * The workflows a run can be scoped to some CWEs (optional — absent means
 * every CWE):
 *   cwe_check  `cwe_ids: ["CWE-79", "CWE-89"]`, up to 50
 */
export const CWE_SCOPED_WORKFLOWS: Partial<Record<SystemMapWorkflowKey, { max: number }>> = {
  cwe_check: { max: 50 },
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
    return { error: `cweIds must hold 1–${scope.max} ids` };
  }
  return ids;
}

/**
 * The same workflows can also be scoped to some System Map components, by
 * name (`SysComponent` `properties.name`, e.g. `"stakwork/hive"`) — absent
 * means every component.
 */
const MAX_COMPONENTS = 50;
const MAX_COMPONENT_NAME = 200;

/**
 * A request's `components` for workflow `key`: undefined when absent, the
 * trimmed, deduplicated names when valid, or an error message.
 */
export function parseComponents(key: SystemMapWorkflowKey, value: unknown): string[] | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (!CWE_SCOPED_WORKFLOWS[key]) return { error: "This workflow does not take components" };
  if (!Array.isArray(value) || !value.every((name): name is string => typeof name === "string")) {
    return { error: "components must be component names" };
  }
  const names = [...new Set(value.map((name) => name.trim()))];
  if (names.some((name) => name === "" || name.length > MAX_COMPONENT_NAME)) {
    return { error: `component names must be 1–${MAX_COMPONENT_NAME} characters` };
  }
  if (names.length === 0 || names.length > MAX_COMPONENTS) {
    return { error: `components must hold 1–${MAX_COMPONENTS} names` };
  }
  return names;
}

/** The workflow input fields for `cweIds` and `components`. */
function cweInput(cweIds: string[] | undefined, components: string[] | undefined): Record<string, unknown> {
  return {
    ...(cweIds?.length ? { cwe_ids: cweIds } : {}),
    ...(components?.length ? { components } : {}),
  };
}

/** The workflows that check some `Finding`s; their runs carry `input.finding_ref_ids`. */
export const FINDING_WORKFLOWS: Partial<Record<SystemMapWorkflowKey, { max: number }>> = {
  finding_verify: { max: 50 },
};
const REF_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * A request's `findingRefIds` / `apply` for workflow `key`: undefined for a
 * workflow that takes neither, the deduplicated ids and `apply` when valid,
 * or an error message.
 */
export function parseFindingInput(
  key: SystemMapWorkflowKey,
  refIds: unknown,
  apply: unknown,
): { findingRefIds: string[]; apply: boolean } | undefined | { error: string } {
  const scope = FINDING_WORKFLOWS[key];
  if (!scope) {
    // The security audit takes `apply` too, validated by `parseSecurityAuditInput`.
    if (key === "security_audit")
      return refIds === undefined ? undefined : { error: "This workflow does not take findings" };
    return refIds === undefined && apply === undefined ? undefined : { error: "This workflow does not take findings" };
  }
  if (!Array.isArray(refIds) || !refIds.every((id): id is string => typeof id === "string" && REF_ID_RE.test(id))) {
    return { error: "findingRefIds must be Finding ref_ids" };
  }
  const ids = [...new Set(refIds)];
  if (ids.length === 0 || ids.length > scope.max) return { error: `findingRefIds must hold 1–${scope.max} ids` };
  if (apply !== undefined && typeof apply !== "boolean") return { error: "apply must be a boolean" };
  return { findingRefIds: ids, apply: apply === true };
}

/** The workflow that audits repos by vulnerability class. */
export const SECURITY_AUDIT_KEY = "security_audit" as const satisfies SystemMapWorkflowKey;
const MAX_AUDIT_REPOS = 50;
const MAX_AUDIT_CALLS = 2000;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface SecurityAuditInput {
  repos: string[];
  classes?: string[];
  /** Concept ref_ids of the classes; the workflow prefers them over `classes`. */
  classIds?: string[];
  apply: boolean;
  maxAgentCalls?: number;
}

/**
 * A request's `repos` / `classIds` / `classes` / `apply` / `maxAgentCalls` for workflow
 * `key`: undefined for a workflow that takes none, the validated input for
 * the security audit, or an error message. `classes` are matched (trimmed,
 * case-insensitively) against the live Security Audit Concepts — the list
 * the picker shows, built-in when unreadable — and sent by their canonical name.
 * `classIds` must be ref_ids of those Concepts, and take precedence over `classes`.
 */
export async function parseSecurityAuditInput(
  key: SystemMapWorkflowKey,
  fields: { repos?: unknown; classIds?: unknown; classes?: unknown; apply?: unknown; maxAgentCalls?: unknown },
  who: { workspaceId: string; userId: string },
): Promise<SecurityAuditInput | undefined | { error: string }> {
  const { repos, classIds, classes, apply, maxAgentCalls } = fields;
  if (key !== SECURITY_AUDIT_KEY) {
    return repos === undefined && classIds === undefined && classes === undefined && maxAgentCalls === undefined
      ? undefined
      : { error: "This workflow does not take repos, classes, classIds or maxAgentCalls" };
  }
  if (!Array.isArray(repos) || !repos.every((r): r is string => typeof r === "string" && REPO_RE.test(r))) {
    return { error: 'repos must be repositories like "owner/name"' };
  }
  const uniqueRepos = [...new Set(repos)];
  if (uniqueRepos.length === 0 || uniqueRepos.length > MAX_AUDIT_REPOS) {
    return { error: `repos must hold 1–${MAX_AUDIT_REPOS} repositories` };
  }
  let uniqueClasses: string[] | undefined;
  let uniqueClassIds: string[] | undefined;
  if (classIds !== undefined) {
    const ids = (await getSecurityAuditClasses(who.workspaceId, who.userId)).flatMap((c) =>
      c.ref_id ? [c.ref_id] : [],
    );
    if (ids.length === 0) {
      return { error: "classIds cannot be checked while the live classes are unavailable; send class names instead" };
    }
    if (!Array.isArray(classIds) || !classIds.every((id): id is string => typeof id === "string" && ids.includes(id))) {
      return { error: "classIds must be among: " + ids.join(", ") };
    }
    uniqueClassIds = [...new Set(classIds)];
    if (uniqueClassIds.length === 0) return { error: "classIds must not be empty" };
  } else if (classes !== undefined) {
    const known = (await getSecurityAuditClasses(who.workspaceId, who.userId)).map((c) => c.name);
    const canonical = new Map(known.map((name) => [name.toLowerCase(), name]));
    const names =
      Array.isArray(classes) && classes.every((c): c is string => typeof c === "string")
        ? classes.map((c) => canonical.get(c.trim().toLowerCase()))
        : [];
    if (!Array.isArray(classes) || names.length !== classes.length || names.some((n) => n === undefined)) {
      return { error: "classes must be among: " + known.join(", ") };
    }
    uniqueClasses = [...new Set(names as string[])];
    if (uniqueClasses.length === 0) return { error: "classes must not be empty" };
  }
  if (apply !== undefined && typeof apply !== "boolean") return { error: "apply must be a boolean" };
  if (
    maxAgentCalls !== undefined &&
    (typeof maxAgentCalls !== "number" ||
      !Number.isInteger(maxAgentCalls) ||
      maxAgentCalls < 1 ||
      maxAgentCalls > MAX_AUDIT_CALLS)
  ) {
    return { error: `maxAgentCalls must be an integer 1–${MAX_AUDIT_CALLS}` };
  }
  return {
    repos: uniqueRepos,
    ...(uniqueClassIds ? { classIds: uniqueClassIds } : {}),
    ...(uniqueClasses ? { classes: uniqueClasses } : {}),
    apply: apply === true,
    ...(maxAgentCalls !== undefined ? { maxAgentCalls } : {}),
  };
}

/** The swarm id the audit workflow derives its URL and secret from: `Swarm.name`, else the `swarmUrl` host's first label. */
function swarmIdOf(swarm: { name?: string | null; swarmUrl?: string | null }): string | null {
  if (swarm.name) return swarm.name;
  try {
    return new URL(swarm.swarmUrl ?? "").hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function auditFromInput(input: unknown): Record<string, unknown> {
  const i = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const tf = i.target_filter && typeof i.target_filter === "object" ? (i.target_filter as Record<string, unknown>) : {};
  const strs = (v: unknown) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  return {
    repos: strs(tf.repos),
    classes: strs(i.classes),
    maxAgentCalls: typeof i.max_agent_calls === "number" ? i.max_agent_calls : null,
  };
}

function applyOf(input: unknown): boolean | null {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>).apply : undefined;
  return typeof value === "boolean" ? value : null;
}

function stringsFromInput(input: unknown, field: "cwe_ids" | "components" | "finding_ref_ids"): string[] | null {
  if (!input || typeof input !== "object") return null;
  const values = (input as Record<string, unknown>)[field];
  return Array.isArray(values) && values.length > 0 && values.every((x) => typeof x === "string")
    ? (values as string[])
    : null;
}

export function isSystemMapWorkflowKey(value: unknown): value is SystemMapWorkflowKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SYSTEM_MAP_WORKFLOWS, value);
}

/** Every kind the page owns — the completion handler is shared. */
export const SYSTEM_MAP_KINDS = Object.values(SYSTEM_MAP_WORKFLOWS).map((w) => w.kind);

// Back-compat names for the first workflow.
export const SYSTEM_MAP_KIND = SYSTEM_MAP_WORKFLOWS.system_map.kind;
export const SYSTEM_MAP_WORKFLOW = SYSTEM_MAP_WORKFLOWS.system_map.workflow;
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
    cweIds: stringsFromInput(row.input, "cwe_ids"),
    components: stringsFromInput(row.input, "components"),
    findingRefIds: stringsFromInput(row.input, "finding_ref_ids"),
    apply: applyOf(row.input),
    ...(auditFromInput(row.input) as Pick<SystemMapRun, "repos" | "classes" | "maxAgentCalls">),
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

/** Rows of one workflow, narrowed to the runs that cover any of `findingRefIds` when given. */
function runsWhere(workspaceId: string, key: SystemMapWorkflowKey, findingRefIds?: string[]) {
  return {
    workspaceId,
    kind: SYSTEM_MAP_WORKFLOWS[key].kind,
    ...(findingRefIds?.length
      ? { OR: findingRefIds.map((id) => ({ input: { path: ["finding_ref_ids"], array_contains: [id] } })) }
      : {}),
  };
}

/**
 * The workspace's runs of one workflow (of one finding, with
 * `findingRefId`), newest first, PENDING ones settled from strut when they are over.
 */
export async function listSystemMapRuns(
  workspaceId: string,
  key: SystemMapWorkflowKey = "system_map",
  opts: { now?: Date; limit?: number; findingRefId?: string } = {},
): Promise<SystemMapRun[]> {
  const now = opts.now ?? new Date();
  const [rows, orgLogin] = await Promise.all([
    db.strutRun.findMany({
      where: runsWhere(workspaceId, key, opts.findingRefId ? [opts.findingRefId] : undefined),
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

/**
 * Is a run of this workflow already in flight for the workspace? (One at a
 * time, per workflow — for a finding check, per finding: none of
 * `findingRefIds` may be in a check already running.)
 */
export async function hasPendingSystemMapRun(
  workspaceId: string,
  key: SystemMapWorkflowKey = "system_map",
  findingRefIds?: string[],
): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: { ...runsWhere(workspaceId, key, findingRefIds), status: StrutRunStatus.PENDING },
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
  /** Which workflow; defaults to the system map. */
  key?: SystemMapWorkflowKey;
  /** Scope a CWE workflow (`CWE_SCOPED_WORKFLOWS`) to these CWEs; validate with `parseCweIds`. */
  cweIds?: string[];
  /** Scope it to these System Map components; validate with `parseComponents`. */
  components?: string[];
  /** The findings a finding check (`FINDING_WORKFLOWS`) runs on; validate with `parseFindingInput`. */
  findings?: { findingRefIds: string[]; apply: boolean };
  /** The security audit's repos and options; validate with `parseSecurityAuditInput`. */
  audit?: SecurityAuditInput;
}

/**
 * Launch the workflow for the workspace's swarm. Throws `StrutDispatchError`
 * when the workspace has no swarm URL or secret alias (`no_target`) or
 * nothing is running on strut's side.
 */
export async function launchSystemMapRun(
  args: LaunchSystemMapRunArgs,
): Promise<DispatchStrutRunResult & { strutUrl: string | null }> {
  const workspace = await db.workspace.findUnique({
    where: { id: args.workspaceId },
    select: {
      swarm: { select: { name: true, swarmUrl: true, swarmSecretAlias: true } },
      sourceControlOrg: { select: { githubLogin: true } },
    },
  });
  const swarm = workspace?.swarm;
  if (!swarm?.swarmUrl || !swarm.swarmSecretAlias) {
    throw new StrutDispatchError("no_target", "This workspace has no swarm URL or secret alias to map.");
  }
  const key = args.key ?? "system_map";
  if (FINDING_WORKFLOWS[key] && !args.findings?.findingRefIds.length) throw new Error("A finding check needs findings");
  if (key === SECURITY_AUDIT_KEY && !args.audit?.repos.length) throw new Error("A security audit needs repos");
  const swarmId = key === SECURITY_AUDIT_KEY ? swarmIdOf(swarm) : null;
  if (key === SECURITY_AUDIT_KEY && !swarmId) {
    throw new StrutDispatchError("no_target", "Could not determine this workspace's swarm id.");
  }
  const { kind, workflow } = SYSTEM_MAP_WORKFLOWS[key];
  const dispatched = await dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind,
    workflow,
    purpose: "system_map",
    input: {
      // `swarm-systemmap` and the package CVE check read the swarm alone; the CWE workflows still take the slug.
      ...(key === "system_map" || key === "package_cves" || key === SECURITY_AUDIT_KEY || FINDING_WORKFLOWS[key]
        ? {}
        : { workspace: args.workspaceSlug }),
      ...(FINDING_WORKFLOWS[key] && args.findings
        ? { finding_ref_ids: args.findings.findingRefIds, workspace_id: args.workspaceId, apply: args.findings.apply }
        : {}),
      ...(key === SECURITY_AUDIT_KEY && args.audit
        ? {
            swarm: swarmId,
            target_filter: { repos: args.audit.repos },
            ...(args.audit.classIds?.length ? { class_ids: args.audit.classIds } : {}),
            ...(args.audit.classes?.length ? { classes: args.audit.classes } : {}),
            apply: args.audit.apply,
            ...(args.audit.maxAgentCalls !== undefined ? { max_agent_calls: args.audit.maxAgentCalls } : {}),
          }
        : {}),
      swarm_url: transformSwarmUrlToRepo2Graph(swarm.swarmUrl),
      swarm_secret_alias: swarm.swarmSecretAlias,
      ...cweInput(args.cweIds, args.components),
    },
    publicBaseUrl: args.publicBaseUrl,
  });
  const orgLogin = workspace?.sourceControlOrg?.githubLogin;
  return {
    ...dispatched,
    strutUrl:
      orgLogin && dispatched.strutRunId
        ? strutViewPath(orgLogin, strutRunDeepLink(workflow, dispatched.strutRunId))
        : null,
  };
}
