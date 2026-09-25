/**
 * Strut runs — hive's generic way to launch a strut workflow, hear its
 * result without polling, and track it (strut `plans/code-change.md` §5).
 *
 * One `StrutRun` row per launch. The flow:
 *
 *   dispatchStrutRun   resolve the target (ONE policy — `strut-target.ts`)
 *                      → PENDING row with the target's `swarmId`
 *                      → push the user's delegation + actor secrets to it
 *                      → POST {lab}/workflows/<name>/run { input, callback }
 *                      → refuse a 202 without `callback: true`
 *                      → store `strutRunId`.
 *   completeStrutRun   the token-gated, idempotent claim PENDING → terminal
 *                      (webhook and reconcile share it), then the KIND's
 *                      handler, which validates `output` with its own schema
 *                      and does the delivery. A handler failure is reported
 *                      as `retry` so the webhook answers 5xx and strut
 *                      re-posts; handlers are idempotent, and a replay of a
 *                      settled row re-runs the handler so a delivery that
 *                      failed after the claim still lands.
 *   reconcileStrutRuns rows PENDING past a threshold → GET the run summary
 *                      from the ROW's swarm → the same completion, or LOST
 *                      when strut never saw the run, or when the run is
 *                      `stale` (no live controller: strut restarted and did
 *                      not resume it) — re-checked once, 10 s later, so a
 *                      run strut is about to auto-resume is not declared
 *                      dead in the seconds between its boot and its scan.
 *   cancelStrutRun     POST …/cancel on the row's swarm (the Stop button);
 *                      the callback then arrives as `cancelled`.
 *
 * Routing comes from the row, never from a callback payload: the delivery
 * target (`conversationId`, `proposalId`), the workspace, the swarm. The
 * callback URL is the credential — token only in the query string (strut
 * sends no custom headers), SHA-256 at rest, constant-time compare in the
 * route, never logged.
 */

import crypto from "crypto";
import { Prisma, StrutRunStatus, type StrutRun } from "@prisma/client";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { STRUT_ACTOR_HEADER, ensureStrutDelegation, strutLabBaseUrl } from "@/services/bifrost/strut-delegation";
import { ensureStrutActorSecrets } from "@/services/strut-actor-secret";
import { describeStrutTargetError, resolveStrutTarget, type StrutPurpose } from "@/services/strut-target";

export const STRUT_RUN_LOG_TAG = "STRUT_RUN";

const LAUNCH_TIMEOUT_MS = 15_000;
const CONTROL_TIMEOUT_MS = 10_000;
/** Cap on a stored `error` string. */
const MAX_ERROR_CHARS = 4_000;
/** Reconcile: leave a PENDING row alone this long — callbacks land within seconds-to-minutes. */
export const STRUT_RUN_RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;
const RECONCILE_BATCH = 25;
/**
 * A `stale` run is re-probed after this long before it is declared LOST.
 * Strut's boot-time auto-resume starts ~3 s after it comes up; a run it is
 * about to resume looks stale until then. One wait per cron pass, for the
 * whole batch of stale rows.
 */
export const STRUT_RUN_STALE_RECHECK_MS = 10_000;

export type StrutRunTerminalStatus = "success" | "error" | "cancelled";

/** What a callback or a summary says about a settled run. */
export interface StrutRunCompletion {
  status: StrutRunTerminalStatus;
  output?: unknown;
  error?: string | null;
  durationMs?: number | null;
}

/** The row a kind's handler receives — settled, read back from the DB. */
export type StrutRunRow = Pick<
  StrutRun,
  | "id"
  | "workspaceId"
  | "swarmId"
  | "userId"
  | "kind"
  | "workflow"
  | "strutRunId"
  | "status"
  | "input"
  | "output"
  | "error"
  | "durationMs"
  | "conversationId"
  | "proposalId"
  | "createdAt"
  | "settledAt"
>;

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
  createdAt: true,
  settledAt: true,
} satisfies Prisma.StrutRunSelect;

/** A kind's completion handler: idempotent, throws to ask for a retry. */
export type StrutRunHandler = (row: StrutRunRow) => Promise<void>;

/**
 * Kind → handler. Lazy so this module stays light (a handler pulls in the
 * conversation writer, Pusher, diff hygiene, …). One entry per `kind`.
 */
const HANDLERS: Record<string, () => Promise<StrutRunHandler>> = {
  code_change_propose: async () => (await import("./strut-runs/code-change-propose")).handleCodeChangeProposeSettled,
  code_change_land: async () => (await import("./strut-runs/code-change-land")).handleCodeChangeLandSettled,
  system_map: async () => (await import("./strut-runs/system-map")).handleSystemMapSettled,
};

export function hashStrutRunToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** The status a terminal completion writes on the row. */
export function rowStatusFor(status: StrutRunTerminalStatus): StrutRunStatus {
  return status === "success"
    ? StrutRunStatus.SUCCESS
    : status === "cancelled"
      ? StrutRunStatus.CANCELLED
      : StrutRunStatus.ERROR;
}

function capError(error: string | null | undefined): string | null {
  if (error == null) return null;
  const s = String(error);
  return s.length > MAX_ERROR_CHARS ? `${s.slice(0, MAX_ERROR_CHARS)}…` : s;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

// ─── Dispatch ────────────────────────────────────────────────────────────

export type StrutDispatchFailureCode =
  | "no_target"
  | "unreachable"
  | "bad_callback_url"
  | "workflow_missing"
  | "strut_http"
  | "callbacks_unsupported"
  | "no_run_id";

export class StrutDispatchError extends Error {
  constructor(
    public readonly code: StrutDispatchFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "StrutDispatchError";
  }
}

export interface DispatchStrutRunArgs {
  /** The workspace the launch is FOR (recorded on the row; the policy picks the swarm). */
  workspaceId: string;
  userId: string;
  /** Completion-handler discriminator — a key of `HANDLERS`. */
  kind: string;
  /** Strut workflow name. */
  workflow: string;
  /**
   * The workflow `input`. NEVER a credential: strut persists it on
   * `run.start`. A function receives the new row's id first — for an input
   * that must name this attempt (a branch unique per `StrutRun`).
   */
  input: Record<string, unknown> | ((runId: string) => Record<string, unknown>);
  purpose: StrutPurpose;
  /** Swarm-reachable base URL of THIS hive, captured from the request host. */
  publicBaseUrl: string;
  conversationId?: string;
  proposalId?: string;
  /**
   * Per-actor secrets pushed to the target before the launch
   * (`PUT /actors/:actor/secrets/:name`) — the user's `GITHUB_TOKEN` for a
   * clone. Never logged, never in `input`, never on the row.
   */
  actorSecrets?: Record<string, string | null | undefined>;
}

/**
 * No link to the run is handed back: a URL people can open is the
 * CALLER's to build, from what it knows about where the run is visible —
 * for a target the org strut view embeds, `strutViewPath(login,
 * strutRunDeepLink(workflow, strutRunId))` (`lib/utils/strut-links`).
 * Strut's own URL on the swarm needs the embed token that view mints.
 */
export interface DispatchStrutRunResult {
  /** `StrutRun.id` — the active-run key and the webhook's `id`. */
  runId: string;
  /** Strut's run id on its swarm. */
  strutRunId: string;
  swarmId: string;
}

async function failRow(id: string, error: string): Promise<void> {
  await db.strutRun
    .updateMany({
      where: { id, status: StrutRunStatus.PENDING },
      data: { status: StrutRunStatus.ERROR, error: capError(error), settledAt: new Date() },
    })
    .catch((e) =>
      logger.warn("Failed to retire a strut run row (non-fatal)", STRUT_RUN_LOG_TAG, {
        runId: id,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
}

/**
 * Launch a strut workflow with a callback and track it. Throws
 * `StrutDispatchError` when nothing is running on strut's side (the row,
 * if created, is marked ERROR with the reason).
 */
export async function dispatchStrutRun(args: DispatchStrutRunArgs): Promise<DispatchStrutRunResult> {
  const { workspaceId, userId, kind, workflow, purpose, publicBaseUrl, conversationId, proposalId } = args;
  if (!HANDLERS[kind]) throw new Error(`No strut-run handler for kind "${kind}"`);

  const resolved = await resolveStrutTarget({ purpose, userId, workspaceId });
  if (!resolved.ok) {
    throw new StrutDispatchError("no_target", describeStrutTargetError(resolved.error));
  }
  const { target } = resolved;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const row = await db.strutRun.create({
    data: {
      tokenHash: hashStrutRunToken(rawToken),
      workspaceId,
      swarmId: target.swarmId,
      userId,
      kind,
      workflow,
      input: typeof args.input === "function" ? Prisma.DbNull : toJson(args.input),
      ...(conversationId ? { conversationId } : {}),
      ...(proposalId ? { proposalId } : {}),
    },
    select: { id: true },
  });
  // An input derived from the row's id is stored once it exists, before the
  // launch — the row is what the handler reads back.
  let input: Record<string, unknown>;
  if (typeof args.input === "function") {
    input = args.input(row.id);
    await db.strutRun.update({ where: { id: row.id }, data: { input: toJson(input) } });
  } else {
    input = args.input;
  }

  // Pushes are per target and idempotent, before EVERY dispatch. Neither
  // throws nor blocks the launch.
  await ensureStrutDelegation(
    { workspaceId: target.workspaceId, workspaceSlug: target.workspaceSlug, userId },
    { swarmUrl: target.swarmUrl, swarmApiKey: target.swarmApiKey },
    { actor: target.actor },
  );
  if (args.actorSecrets) {
    await ensureStrutActorSecrets(
      { labBase: target.labBase, swarmApiKey: target.swarmApiKey },
      target.actor,
      args.actorSecrets,
    );
  }

  // The URL is the credential. Never log it.
  const callbackUrl = `${publicBaseUrl}/api/strut-runs/webhook?id=${row.id}&token=${rawToken}`;

  let res: Response;
  try {
    res = await fetch(`${target.labBase}/workflows/${encodeURIComponent(workflow)}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": target.swarmApiKey,
        [STRUT_ACTOR_HEADER]: target.actor,
      },
      body: JSON.stringify({ input, callback: { url: callbackUrl } }),
      cache: "no-store",
      signal: AbortSignal.timeout(LAUNCH_TIMEOUT_MS),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await failRow(row.id, `initiation_failed: ${detail}`);
    logger.error("Strut unreachable at dispatch", STRUT_RUN_LOG_TAG, { runId: row.id, workflow, swarmId: target.swarmId, error: detail });
    throw new StrutDispatchError("unreachable", "Could not reach strut on the workspace swarm.");
  }

  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    await failRow(row.id, `strut_http_${res.status}${detail ? `: ${detail}` : ""}`);
    if (res.status === 404) {
      throw new StrutDispatchError(
        "workflow_missing",
        `Strut on this swarm has no "${workflow}" workflow (not seeded yet).`,
      );
    }
    if (res.status === 400) {
      throw new StrutDispatchError("bad_callback_url", detail || "Strut refused the launch (400).");
    }
    throw new StrutDispatchError("strut_http", detail || `Strut returned HTTP ${res.status}.`);
  }

  const accepted = (await res.json().catch(() => ({}))) as { runId?: unknown; callback?: unknown };
  const strutRunId = typeof accepted.runId === "string" && accepted.runId ? accepted.runId : null;

  if (accepted.callback !== true) {
    // The run IS running on a strut that will never call back. Stop it if
    // we can (best effort) and refuse the dispatch.
    if (strutRunId) {
      void postControl(target.labBase, target.swarmApiKey, workflow, strutRunId, "cancel").catch(() => undefined);
    }
    await failRow(row.id, "strut_callbacks_unsupported");
    throw new StrutDispatchError(
      "callbacks_unsupported",
      "This swarm's strut is too old to post results back; the change cannot be tracked.",
    );
  }
  if (!strutRunId) {
    await failRow(row.id, "no_run_id");
    throw new StrutDispatchError("no_run_id", "Strut accepted the launch but returned no run id.");
  }

  await db.strutRun.update({ where: { id: row.id }, data: { strutRunId } });
  logger.info("Dispatched strut run", STRUT_RUN_LOG_TAG, {
    runId: row.id,
    kind,
    workflow,
    strutRunId,
    swarmId: target.swarmId,
    workspaceId,
  });

  return { runId: row.id, strutRunId, swarmId: target.swarmId };
}

// ─── The row's swarm (never the policy) ───────────────────────────────────

interface RowLab {
  labBase: string;
  swarmApiKey: string;
}

/** Where a row's run lives, from the row's `swarmId`. Null when the swarm is gone. */
export async function labForRow(row: Pick<StrutRunRow, "swarmId">): Promise<RowLab | null> {
  const swarm = await db.swarm.findUnique({
    where: { id: row.swarmId },
    select: { swarmUrl: true, swarmApiKey: true },
  });
  if (!swarm?.swarmUrl || !swarm.swarmApiKey) return null;
  try {
    return {
      labBase: strutLabBaseUrl(swarm.swarmUrl),
      swarmApiKey: EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey),
    };
  } catch (err) {
    logger.warn("Could not decrypt the swarm key for a strut run", STRUT_RUN_LOG_TAG, {
      swarmId: row.swarmId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function postControl(
  labBase: string,
  swarmApiKey: string,
  workflow: string,
  strutRunId: string,
  action: "cancel",
): Promise<Response> {
  return fetch(
    `${labBase}/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(strutRunId)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": swarmApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    },
  );
}

/**
 * Ask strut to cancel a run (cooperative — the callback then arrives as
 * `cancelled` and settles the row). Returns whether strut acknowledged.
 * Never throws.
 */
export async function cancelStrutRun(row: Pick<StrutRunRow, "id" | "swarmId" | "workflow" | "strutRunId">): Promise<boolean> {
  if (!row.strutRunId) return false;
  const lab = await labForRow(row);
  if (!lab) return false;
  try {
    const res = await postControl(lab.labBase, lab.swarmApiKey, row.workflow, row.strutRunId, "cancel");
    logger.info("Strut cancel", STRUT_RUN_LOG_TAG, { runId: row.id, status: res.status });
    // 409 = already settled / not live: nothing to cancel, which is fine.
    return res.ok || res.status === 409;
  } catch (err) {
    logger.warn("Strut cancel failed", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * The Stop button: cancel every PENDING strut run a conversation is
 * waiting on. Returns the rows it addressed (so the caller can skip them
 * in the swarm `/repo/agent` abort loop) and how many strut acknowledged.
 */
export async function cancelPendingStrutRunsForConversation(
  conversationId: string,
): Promise<{ rows: Array<{ id: string; kind: string }>; cancelled: number }> {
  const rows = await db.strutRun.findMany({
    where: { conversationId, status: StrutRunStatus.PENDING },
    select: { id: true, kind: true, swarmId: true, workflow: true, strutRunId: true },
  });
  let cancelled = 0;
  for (const row of rows) {
    if (await cancelStrutRun(row)) cancelled++;
  }
  return { rows: rows.map((r) => ({ id: r.id, kind: r.kind })), cancelled };
}

// ─── Completion ──────────────────────────────────────────────────────────

export type CompleteStrutRunOutcome =
  /** This call moved the row PENDING → terminal and the handler ran. */
  | "claimed"
  /** The row was already settled; the handler re-ran (idempotent). */
  | "replayed"
  /** The handler failed — answer 5xx so strut re-delivers. */
  | "retry"
  /** Nothing claimed and the row is still PENDING (token/hash mismatch). */
  | "unclaimed";

/**
 * Settle a row and deliver. The claim is `updateMany` gated on the token
 * hash and PENDING, so two deliveries can never both win; whichever loses
 * still runs the handler against the SETTLED row, which is idempotent.
 */
export async function completeStrutRun(
  row: { id: string; tokenHash: string },
  completion: StrutRunCompletion,
): Promise<CompleteStrutRunOutcome> {
  const { count } = await db.strutRun.updateMany({
    where: { id: row.id, tokenHash: row.tokenHash, status: StrutRunStatus.PENDING },
    data: {
      status: rowStatusFor(completion.status),
      output: completion.status === "success" ? toJson(completion.output) : Prisma.DbNull,
      error: completion.status === "success" ? null : capError(completion.error) ?? (completion.status === "cancelled" ? null : "failed"),
      durationMs: typeof completion.durationMs === "number" ? Math.round(completion.durationMs) : null,
      settledAt: new Date(),
    },
  });

  const settled = await db.strutRun.findUnique({ where: { id: row.id }, select: ROW_SELECT });
  if (!settled || settled.status === StrutRunStatus.PENDING) return "unclaimed";

  const outcome: CompleteStrutRunOutcome = count > 0 ? "claimed" : "replayed";
  logger.info("Strut run settled", STRUT_RUN_LOG_TAG, {
    runId: row.id,
    kind: settled.kind,
    status: settled.status,
    outcome,
  });
  return (await runHandler(settled)) ? outcome : "retry";
}

/** Run a settled row's kind handler. `false` = it threw (retry). */
export async function runHandler(row: StrutRunRow): Promise<boolean> {
  const load = HANDLERS[row.kind];
  if (!load) {
    logger.error("No handler for a settled strut run", STRUT_RUN_LOG_TAG, { runId: row.id, kind: row.kind });
    return true; // nothing to retry into
  }
  try {
    const handler = await load();
    await handler(row);
    return true;
  } catch (err) {
    logger.error("Strut run handler failed", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      kind: row.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Mark a PENDING row LOST (strut never saw the run) and deliver that. */
async function loseRow(row: StrutRunRow, reason: string): Promise<CompleteStrutRunOutcome> {
  const { count } = await db.strutRun.updateMany({
    where: { id: row.id, status: StrutRunStatus.PENDING },
    data: { status: StrutRunStatus.LOST, error: capError(reason), settledAt: new Date() },
  });
  const settled = await db.strutRun.findUnique({ where: { id: row.id }, select: ROW_SELECT });
  if (!settled || settled.status === StrutRunStatus.PENDING) return "unclaimed";
  logger.warn("Strut run lost", STRUT_RUN_LOG_TAG, { runId: row.id, kind: row.kind, reason });
  const outcome: CompleteStrutRunOutcome = count > 0 ? "claimed" : "replayed";
  return (await runHandler(settled)) ? outcome : "retry";
}

// ─── Reconcile ───────────────────────────────────────────────────────────

/** Strut's run summary, reduced to what reconcile decides on. */
export type StrutRunSummaryProbe =
  | { kind: "missing" }
  | { kind: "running"; status: string }
  | { kind: "settled"; completion: StrutRunCompletion }
  | { kind: "unavailable"; reason: string };

const TERMINAL: ReadonlySet<string> = new Set(["success", "error", "cancelled"]);

/** `GET {lab}/workflows/:name/runs/:runId` on the ROW's swarm. Never throws. */
export async function probeStrutRun(row: StrutRunRow): Promise<StrutRunSummaryProbe> {
  if (!row.strutRunId) return { kind: "missing" };
  const lab = await labForRow(row);
  if (!lab) return { kind: "unavailable", reason: "swarm credentials unavailable" };
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}`,
      {
        headers: { "x-api-token": lab.swarmApiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      },
    );
    if (res.status === 404) return { kind: "missing" };
    if (!res.ok) return { kind: "unavailable", reason: `HTTP ${res.status}` };
    const summary = (await res.json()) as {
      status?: unknown;
      partial?: unknown;
      output?: unknown;
      error?: { message?: unknown } | null;
      durationMs?: unknown;
    };
    const status = typeof summary.status === "string" ? summary.status : "unknown";
    // `partial: true` = reconstructed from the event log: in flight, or
    // orphaned by a restart (`stale`). Either way not a terminal result.
    if (summary.partial === true || !TERMINAL.has(status)) return { kind: "running", status };
    return {
      kind: "settled",
      completion: {
        status: status as StrutRunTerminalStatus,
        output: summary.output,
        error: typeof summary.error?.message === "string" ? summary.error.message : null,
        durationMs: typeof summary.durationMs === "number" ? summary.durationMs : null,
      },
    };
  } catch (err) {
    return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface ReconcileStrutRunsStats {
  swept: number;
  settled: number;
  lost: number;
  running: number;
  unavailable: number;
  retry: number;
}

/**
 * Act on one probe. Returns `"stale"` when the run has no live controller
 * on strut (the caller re-probes those after a wait), else `"done"`.
 */
async function applyProbe(row: StrutRunRow, probe: StrutRunSummaryProbe, stats: ReconcileStrutRunsStats): Promise<"stale" | "done"> {
  switch (probe.kind) {
    case "running":
      if (probe.status === "stale") return "stale";
      stats.running++;
      return "done";
    case "unavailable":
      stats.unavailable++;
      logger.warn("Strut run summary unavailable", STRUT_RUN_LOG_TAG, { runId: row.id, reason: probe.reason });
      return "done";
    case "missing": {
      const outcome = await loseRow(row, "strut has no record of the run (restart before it was written)");
      if (outcome === "retry") stats.retry++;
      else stats.lost++;
      return "done";
    }
    case "settled": {
      const full = await db.strutRun.findUnique({ where: { id: row.id }, select: { id: true, tokenHash: true } });
      if (!full) return "done";
      const outcome = await completeStrutRun(full, probe.completion);
      if (outcome === "retry") stats.retry++;
      else stats.settled++;
      return "done";
    }
  }
}

/**
 * The backstop for a callback that never arrived (network drop past
 * strut's retries, a hive deploy mid-delivery, a swarm restart). Never
 * re-dispatches. A row still without a strut run id past the threshold —
 * the dispatch died between the row and the launch — is LOST too.
 *
 * A run strut reports `stale` (a log, no summary, no live controller —
 * strut restarted) is either about to be auto-resumed (only the newest
 * cut-off run per workflow, seconds after boot) or will stay stale for
 * good. The two look the same in one probe, so stale rows are probed
 * again after `STRUT_RUN_STALE_RECHECK_MS`; still stale → LOST.
 */
export async function reconcileStrutRuns(
  opts: { now?: Date; minAgeMs?: number; limit?: number; staleRecheckMs?: number } = {},
): Promise<ReconcileStrutRunsStats> {
  const now = opts.now ?? new Date();
  const minAgeMs = opts.minAgeMs ?? STRUT_RUN_RECONCILE_MIN_AGE_MS;
  const stats: ReconcileStrutRunsStats = { swept: 0, settled: 0, lost: 0, running: 0, unavailable: 0, retry: 0 };

  const rows = await db.strutRun.findMany({
    where: { status: StrutRunStatus.PENDING, createdAt: { lt: new Date(now.getTime() - minAgeMs) } },
    select: ROW_SELECT,
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? RECONCILE_BATCH,
  });

  const stale: StrutRunRow[] = [];
  for (const row of rows) {
    stats.swept++;
    try {
      if (!row.strutRunId) {
        const outcome = await loseRow(row, "dispatch never completed");
        if (outcome === "retry") stats.retry++;
        else stats.lost++;
        continue;
      }
      if ((await applyProbe(row, await probeStrutRun(row), stats)) === "stale") stale.push(row);
    } catch (err) {
      stats.unavailable++;
      logger.error("Strut run reconcile threw", STRUT_RUN_LOG_TAG, {
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (stale.length > 0) {
    await new Promise((r) => setTimeout(r, opts.staleRecheckMs ?? STRUT_RUN_STALE_RECHECK_MS));
    for (const row of stale) {
      try {
        if ((await applyProbe(row, await probeStrutRun(row), stats)) !== "stale") continue;
        const outcome = await loseRow(row, "no live run on strut (it restarted and did not resume this run)");
        if (outcome === "retry") stats.retry++;
        else stats.lost++;
      } catch (err) {
        stats.unavailable++;
        logger.error("Strut run reconcile threw", STRUT_RUN_LOG_TAG, {
          runId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (stats.swept > 0) logger.info("Strut runs reconcile", STRUT_RUN_LOG_TAG, { ...stats });
  return stats;
}
