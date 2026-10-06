/**
 * Cross-instance per-turn Stop signal for Jamie canvas chat.
 *
 * `/api/ask/abort` usually runs on a DIFFERENT serverless instance than
 * the `/api/ask/quick` request that is generating the turn, so an
 * in-memory `AbortController` can't be reached directly from the abort
 * request. The signal goes through Redis instead.
 *
 * Two keys per turn:
 *   - `canvas:turn-owner:{turnId}`         — written once by the turn
 *     itself (`registerTurn`), `NX` so only the first write wins. Records
 *     who owns the turn (`userId`, `orgId`, `rowId`, `startedAt`).
 *   - `canvas:turn-abort:{userId}:{turnId}` — written by `requestTurnAbort`
 *     and ALWAYS caller-scoped. A Stop sent before the turn registers can
 *     therefore only ever reach the CALLER'S OWN future turn with that id
 *     — nobody can abort someone else's turn by writing a key ahead of
 *     time.
 *
 * Redis must never be able to break a normal turn:
 *   - If Redis fails or hangs during a turn (register / watch), the turn
 *     continues without Stop (best-effort, logged).
 *   - If Redis fails or hangs during an abort REQUEST, the request throws
 *     `TurnAbortUnavailable` and the route answers 503 — it never
 *     silently "succeeds" with nothing cancelled.
 */

import { redis } from "@/lib/redis";
import { withMcpTimeout } from "@/lib/ai/mcpTimeout";

/** Strict UUID v1-5 (the client mints turnIds via `crypto.randomUUID()`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidTurnId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Both TTLs: longer than `maxDuration` (800s) + after() work; bounds stray keys. */
const TURN_KEY_TTL_SECS = 1200;
const POLL_INTERVAL_MS = 500;
/**
 * ioredis queues commands while it reconnects (up to 20 retries), so an
 * unreachable Redis would otherwise stall the turn start or a Stop press
 * for ~10s before failing.
 */
const REDIS_OP_TIMEOUT_MS = 1500;

function ownerKey(turnId: string): string {
  return `canvas:turn-owner:${turnId}`;
}

function abortKey(userId: string, turnId: string): string {
  return `canvas:turn-abort:${userId}:${turnId}`;
}

interface TurnOwner {
  userId: string;
  orgId: string;
  rowId: string;
  startedAt: string; // ISO timestamp
}

/** Thrown by `requestTurnAbort` on a Redis failure or timeout. */
export class TurnAbortUnavailable extends Error {
  constructor(op: string, cause?: unknown) {
    super(`Turn-abort Redis op unavailable: ${op}`, { cause });
    this.name = "TurnAbortUnavailable";
  }
}

/** The abort reason handed to the turn's `AbortController`. */
export class TurnStoppedError extends Error {
  constructor() {
    super("Turn stopped by user");
    this.name = "TurnStoppedError";
  }
}

/**
 * Register this turn's owner. `NX` — only the first write for a `turnId`
 * wins; a later call is a `conflict` only when the existing owner is a
 * DIFFERENT user (so nobody can take over a turnId they saw in a shared
 * room).
 *
 * Throws on a Redis failure or timeout; the caller logs and runs the
 * turn without Stop.
 */
export async function registerTurn(args: {
  turnId: string;
  userId: string;
  orgId: string;
  rowId: string;
}): Promise<"registered" | "conflict"> {
  const { turnId, userId, orgId, rowId } = args;
  if (!userId) {
    throw new Error("registerTurn: userId is required");
  }
  const owner: TurnOwner = { userId, orgId, rowId, startedAt: new Date().toISOString() };
  const ok = await withMcpTimeout(
    () => redis.set(ownerKey(turnId), JSON.stringify(owner), "EX", TURN_KEY_TTL_SECS, "NX"),
    REDIS_OP_TIMEOUT_MS,
  );
  if (ok === "OK") return "registered";

  const raw = await withMcpTimeout(() => redis.get(ownerKey(turnId)), REDIS_OP_TIMEOUT_MS);
  if (!raw) return "registered"; // expired between SET NX and GET — benign race
  try {
    return (JSON.parse(raw) as TurnOwner).userId === userId ? "registered" : "conflict";
  } catch {
    return "conflict";
  }
}

/**
 * Request abort for a turn. ALWAYS writes the caller-scoped key first (so
 * a Stop sent before the turn registers is still honoured once it does —
 * see `watchTurnAbort`), then returns the owner's `rowId`/`startedAt`
 * ONLY when both `userId` and `orgId` match the registered owner.
 *
 * A Redis error or timeout throws `TurnAbortUnavailable`: the ownership
 * check must never fail open.
 */
export async function requestTurnAbort(args: {
  turnId: string;
  userId: string;
  orgId: string;
}): Promise<{ owner: { rowId: string; startedAt: string } | null }> {
  const { turnId, userId, orgId } = args;
  try {
    await withMcpTimeout(() => redis.set(abortKey(userId, turnId), "1", "EX", TURN_KEY_TTL_SECS), REDIS_OP_TIMEOUT_MS);
  } catch (err) {
    throw new TurnAbortUnavailable("requestTurnAbort:write", err);
  }

  let raw: string | null;
  try {
    raw = await withMcpTimeout(() => redis.get(ownerKey(turnId)), REDIS_OP_TIMEOUT_MS);
  } catch (err) {
    throw new TurnAbortUnavailable("requestTurnAbort:read", err);
  }

  if (!raw) return { owner: null };
  try {
    const existing = JSON.parse(raw) as TurnOwner;
    if (existing.userId === userId && existing.orgId === orgId) {
      return { owner: { rowId: existing.rowId, startedAt: existing.startedAt } };
    }
  } catch {
    // Malformed owner payload — treat as no owner.
  }
  return { owner: null };
}

/**
 * Whether `turnId` is a turn this user started on conversation `rowId`
 * and then stopped — the only kind of turn an edited resend may replace.
 * Read-only; any Redis failure or timeout answers false (nothing is
 * replaced), as does a turn older than the key TTL.
 */
export async function isOwnStoppedTurn(args: {
  turnId: string;
  userId: string;
  orgId: string;
  rowId: string;
}): Promise<boolean> {
  const { turnId, userId, orgId, rowId } = args;
  try {
    const [owner, stopped] = await withMcpTimeout(
      () => Promise.all([redis.get(ownerKey(turnId)), redis.get(abortKey(userId, turnId))]),
      REDIS_OP_TIMEOUT_MS,
    );
    if (!owner || !stopped) return false;
    const existing = JSON.parse(owner) as TurnOwner;
    return existing.userId === userId && existing.orgId === orgId && existing.rowId === rowId;
  } catch {
    return false;
  }
}

/**
 * Poll for the owner's Stop key and abort `controller` when it appears.
 * Checks immediately, then every 500ms, until `stop()` is called, the
 * signal fires, or the key TTL elapses. A poll failure is logged once and
 * the turn keeps running — a Redis outage only disables Stop. A poll that
 * is still waiting on Redis skips the next tick rather than piling up.
 */
export function watchTurnAbort(args: { turnId: string; userId: string; controller: AbortController }): {
  stop: () => void;
} {
  const { turnId, userId, controller } = args;
  const key = abortKey(userId, turnId);
  const deadline = Date.now() + TURN_KEY_TTL_SECS * 1000;
  let inFlight = false;
  let loggedFailure = false;

  const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
  const stop = () => clearInterval(timer);

  async function check(): Promise<void> {
    if (controller.signal.aborted || Date.now() > deadline) return stop();
    if (inFlight) return;
    inFlight = true;
    try {
      if (await redis.get(key)) {
        stop();
        controller.abort(new TurnStoppedError());
      }
    } catch {
      if (!loggedFailure) {
        loggedFailure = true;
        console.warn("[quick-ask] turn-abort-unavailable", { turnId, op: "watch-poll" });
      }
    } finally {
      inFlight = false;
    }
  }

  void check();
  return { stop };
}
