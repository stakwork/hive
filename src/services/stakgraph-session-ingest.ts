/**
 * Stakgraph session ingest — record Jamie's runs as live Turn chains.
 *
 * Jamie (the org canvas agent) runs in hive's process, so stakgraph's
 * in-process Turn emitter never sees it. The ingest API is the
 * out-of-process equivalent: POST the session, POST turns as the run
 * happens, POST the totals at the end, and the chain that lands in the
 * graph is byte-identical in shape to a `repo_agent` run's. See
 * `stakgraph/mcp/docs/session-ingest.md`.
 *
 *   POST /api/sessions              stub the AgentSession
 *   POST /api/sessions/:id/turns    append turns (order comes from the graph)
 *   POST /api/sessions/:id/end      totals + status + final-response retype
 *
 * Three properties drive the design here:
 *
 * 1. **Session per conversation.** A Jamie thread is the unit a human
 *    looks at, so `session_id` is derived from the `SharedConversation`
 *    id, not from a single turn. Re-posting the session is explicitly
 *    safe (it keeps the original node), turn `order` continues from the
 *    graph's chain head, and `/end` totals are *meant* to sum across
 *    runs — so every user turn re-runs the same three calls and the
 *    chain just grows.
 *
 *    Two consequences of that choice, both server-side behavior worth
 *    knowing before you debug a session that looks wrong:
 *
 *    - `status` is only initialized `running` ON CREATE
 *      (`CREATE_AGENT_SESSION_STUB_QUERY`), and `/end` is its only
 *      writer. So from the second user turn onward the session node
 *      reads `success` *while* the next turn streams. The turn chain
 *      itself is still live — `upsert_turns` bumps `turn_count` and
 *      `last_turn_at` per batch — but don't read the status pill as
 *      "this run is finished."
 *    - Conversely, a run killed without `onFinish`/`onError` (the
 *      serverless `maxDuration` cap, which fires neither) leaves the
 *      session `running` — and the NEXT turn's `/end` closes it. The
 *      chain self-heals instead of stranding a session forever.
 *
 * 2. **Fire-and-forget.** `runCanvasAgent` awaits `onStepFinish`, so a
 *    synchronous POST here would add a swarm round-trip to every agent
 *    step's wall-clock time. Nothing in this module is awaited by the
 *    agent loop; failures are logged and swallowed. A down or
 *    unreachable swarm must never break a chat.
 *
 * 3. **One writer per session.** Batches for one session must not both
 *    read the same chain head and number themselves from it. The
 *    per-session queue below serializes writes within this process
 *    (which is also what makes the fire-and-forget ordering correct).
 *    Cross-process concurrency is out of scope — Jamie is turn-by-turn
 *    per conversation, so two in-flight runs on one conversation would
 *    already be a UI bug.
 */

import { getDefaultWorkspaceForOrg } from "@/lib/helpers/org-workspace";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { latestUserInput, turnsFromStepContent, type ExternalTurn } from "@/lib/ai/sessionIngestTurns";

/** Where to POST: a repo2graph base URL (`https://host:3355`) + its token. */
export interface IngestTarget {
  baseUrl: string;
  apiKey: string;
}

/** Session `source` facet — how these runs are filtered in the sessions UI. */
const SOURCE = "hive";
/** Turn-id label: turns read `jamie-<session>-turn-<n>`. Keep it stable. */
const AGENT_LABEL = "jamie";
/** Ceiling enforced by the ingest API. */
const MAX_TURNS_PER_BATCH = 500;
const INGEST_TIMEOUT_MS = 10_000;

/**
 * Off by default. Turning this on starts writing to the org's graph, so
 * it stays an explicit opt-in per environment.
 */
export function isSessionIngestEnabled(): boolean {
  return process.env.STAKGRAPH_SESSION_INGEST_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * POST and swallow. Returns true on success. Never throws: every caller
 * is on a background path where the only correct failure mode is a log
 * line.
 */
async function post(target: IngestTarget, path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${target.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": target.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[session-ingest] POST failed", {
        path,
        status: res.status,
        body: text.slice(0, 200),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[session-ingest] POST threw", {
      path,
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Per-session serialization. The stored tail never rejects, so one
 * failed batch can't poison the next, and it's dropped once it IS the
 * tail so the map can't grow without bound.
 */
const queues = new Map<string, Promise<unknown>>();

function enqueue(sessionId: string, fn: () => Promise<unknown>): void {
  const prev = queues.get(sessionId) ?? Promise.resolve();
  const run = prev.then(fn).catch((err) => {
    console.warn("[session-ingest] queued write threw", {
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
  });
  queues.set(sessionId, run);
  void run.then(() => {
    if (queues.get(sessionId) === run) queues.delete(sessionId);
  });
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

/**
 * The org's home graph: `SourceControlOrg.defaultWorkspaceId` → that
 * workspace's swarm. Same rule the LLM gateway uses to pick an org's
 * Bifrost, so a Jamie run's turns and its token spend land on the same
 * swarm.
 *
 * Returns null when the org has no default workspace or its swarm isn't
 * ACTIVE; the caller falls back to the run's primary workspace.
 */
export async function resolveOrgIngestTarget(orgId: string): Promise<IngestTarget | null> {
  try {
    const ws = await getDefaultWorkspaceForOrg(orgId);
    if (!ws) return null;
    const swarm = await getSwarmAccessByWorkspaceId(ws.id);
    if (!swarm.success) return null;
    // `getSwarmAccessByWorkspaceId` already returns the `:3355`
    // repo2graph base URL, which is where the ingest router is mounted.
    return { baseUrl: swarm.data.swarmUrl, apiKey: swarm.data.swarmApiKey };
  } catch (err) {
    console.warn("[session-ingest] org target resolution failed", {
      orgId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Session ids become Neo4j node keys, so they may not contain `/` and
 * are capped at 256 chars (enforced server-side; mirrored here so a bad
 * id fails as a skipped session rather than a 400 per turn).
 */
export function sessionIdForConversation(conversationId: string): string {
  return `jamie-${conversationId}`.replace(/\//g, "-").slice(0, 256);
}

// ---------------------------------------------------------------------------
// The run handle
// ---------------------------------------------------------------------------

export interface CanvasSessionIngestOptions {
  /** Required — ingest is org-scoped (Jamie), not workspace-chat-scoped. */
  orgId?: string;
  /** The `SharedConversation` id. Required: it IS the session identity. */
  conversationId?: string;
  /** Used when the org has no usable default workspace. */
  fallbackTarget: IngestTarget;
  /** `owner/repo` of the primary workspace, for the session + bare concept ids. */
  repo?: string;
  /** The turn's model messages; the trailing user message opens the chain. */
  messages?: unknown;
}

export interface CanvasSessionIngest {
  readonly sessionId: string;
  /** Append one agent step's turns. Fire-and-forget. */
  recordStep(content: unknown, features: Record<string, unknown>[]): void;
  /** Post totals + status. Idempotent per handle — see `end` below. */
  end(args: { status: "success" | "error" | "aborted"; errorMessage?: string; model?: string; usage?: unknown }): void;
}

/**
 * Normalize the AI SDK's usage shape onto the ingest API's snake_case
 * token fields. Tolerates the v6 nested `inputTokenDetails` shape and
 * the legacy flat one.
 */
export function toIngestUsage(usage: unknown):
  | {
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
    }
  | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input_tokens: num(u.inputTokens),
    output_tokens: num(u.outputTokens),
    cache_read_tokens: num(u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens),
    cache_write_tokens: num(u.inputTokenDetails?.cacheWriteTokens),
  };
}

/**
 * Open (or resume) the conversation's session and return a handle for
 * the run. Returns null when ingest is disabled or this isn't a Jamie
 * run — callers treat null as "don't record".
 *
 * The session POST and the opening `user_input` turn are queued, not
 * awaited: everything else this handle does chains behind them, so a
 * turn batch can never outrun the session node and hit the 404.
 */
export function startCanvasSessionIngest(opts: CanvasSessionIngestOptions): CanvasSessionIngest | null {
  if (!isSessionIngestEnabled()) return null;
  const { orgId, conversationId } = opts;
  // Org + conversation are both load-bearing: org picks the graph,
  // conversation IS the session identity. The workspace dashboard chat
  // (no orgId) and conversation-less programmatic runs are out of scope.
  if (!orgId || !conversationId) return null;

  const sessionId = sessionIdForConversation(conversationId);
  let target: IngestTarget | null = null;
  let ended = false;

  enqueue(sessionId, async () => {
    target = (await resolveOrgIngestTarget(orgId)) ?? opts.fallbackTarget;
    const ok = await post(target, "/api/sessions", {
      session_id: sessionId,
      source: SOURCE,
      agent_name: AGENT_LABEL,
      ...(opts.repo ? { repo: opts.repo } : {}),
    });
    if (!ok) {
      // Turns would 404 against a session that was never created.
      target = null;
      return;
    }
    const userInput = latestUserInput(opts.messages);
    if (userInput) {
      await post(target, `/api/sessions/${sessionId}/turns`, {
        agent: AGENT_LABEL,
        turns: [{ turn_type: "user_input", content: userInput }],
      });
    }
  });

  return {
    sessionId,
    recordStep(content, features) {
      const turns = turnsFromStepContent(content, features, opts.repo);
      if (turns.length === 0) return;
      enqueue(sessionId, async () => {
        if (!target) return;
        for (let i = 0; i < turns.length; i += MAX_TURNS_PER_BATCH) {
          const batch: ExternalTurn[] = turns.slice(i, i + MAX_TURNS_PER_BATCH);
          const ok = await post(target!, `/api/sessions/${sessionId}/turns`, {
            agent: AGENT_LABEL,
            turns: batch,
          });
          // A failed batch means those turns never landed. Stop rather
          // than posting the next batch, which would number itself from
          // the old chain head and silently reorder the run.
          if (!ok) return;
        }
      });
    },
    end(args) {
      // `/end` accumulates token counts on the session node, so a second
      // call for the same run double-counts. `onError` and `onFinish`
      // can both fire on a mid-stream error — first one wins.
      if (ended) return;
      ended = true;
      const usage = toIngestUsage(args.usage);
      enqueue(sessionId, async () => {
        if (!target) return;
        await post(target, `/api/sessions/${sessionId}/end`, {
          status: args.status,
          ...(args.errorMessage ? { error_message: args.errorMessage.slice(0, 1000) } : {}),
          ...(args.model ? { model: args.model } : {}),
          ...(usage ? { usage } : {}),
        });
      });
    },
  };
}
