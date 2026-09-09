/**
 * Server-side assembly of one run's complete trace for the offline HTML
 * export: every top-level session, every descendant, every turn page, the
 * derived cascade model, and a pre-captured peek for each Concept the run
 * READ — so the exported page can open the same peeks without a network.
 *
 * Reuses the cascade proxy routes' own fetch helpers (server.ts) and the run
 * report export's bounded peek prefetch, so the snapshot is exactly what the
 * live panel would have assembled client-side, minus the polling.
 */

import { assembleRunCascade, mergeTurns } from "../derive";
import {
  fetchRunSessions,
  fetchSessionDetail,
  fetchSessionTurns,
  mockIdentifier,
  type CascadeAccess,
} from "../server";
import {
  buildMockCascadeSessions,
  buildMockSessionDetail,
  buildMockSessionTurns,
} from "../fixtures";
import type { CascadeSession, CascadeTurn, RunCascadeModel } from "../types";
import { prefetchNodePeeks } from "@/lib/run-report/export/peek-prefetch";
import type { NodePeek } from "@/components/run-report/NodePeek";
import type { CascadeExportPayload } from "./payload";

export type { CascadeExportMeta, CascadeExportPayload } from "./payload";

/** A run can touch far more concepts than a report cites — a wider cap. */
export const CASCADE_EXPORT_MAX_PEEKS = 200;
export const CASCADE_EXPORT_PEEK_BUDGET_MS = 20_000;
/** Turn pages per session — a 1000-turn page each, so 25 is ample. */
const MAX_TURN_PAGES = 25;

interface SessionSource {
  listSessions(): Promise<{ identifier: string | null; sessions: CascadeSession[] }>;
  descendantsOf(session: CascadeSession): Promise<CascadeSession[]>;
  turnsPage(sessionId: string, after: number): Promise<CascadeTurn[] | null>;
}

function liveSource(access: CascadeAccess): SessionSource {
  return {
    listSessions: () => fetchRunSessions(access),
    descendantsOf: async (session) =>
      (await fetchSessionDetail(access, session.id))?.descendants ?? [],
    turnsPage: async (sessionId, after) =>
      (await fetchSessionTurns(access, sessionId, after))?.turns ?? null,
  };
}

function mockSource(access: CascadeAccess): SessionSource {
  const identifier = mockIdentifier(access);
  return {
    listSessions: async () => ({
      identifier,
      sessions: buildMockCascadeSessions(identifier),
    }),
    descendantsOf: async (session) =>
      buildMockSessionDetail(identifier, session.id, true)?.descendants ?? [],
    turnsPage: async (sessionId, after) =>
      buildMockSessionTurns(identifier, sessionId, after)?.turns ?? null,
  };
}

/** Every turn of one session, following the order cursor page by page. */
async function fetchAllTurns(
  source: SessionSource,
  session: CascadeSession,
): Promise<CascadeTurn[]> {
  let turns: CascadeTurn[] = [];
  let after = -1;
  for (let page = 0; page < MAX_TURN_PAGES; page++) {
    const pageTurns = await source.turnsPage(session.id, after);
    if (!pageTurns || pageTurns.length === 0) break;
    turns = mergeTurns(turns, pageTurns);
    const maxOrder = turns[turns.length - 1].order;
    // No cursor progress, or the version counter says we have everything.
    if (maxOrder <= after || turns.length >= session.turn_count) break;
    after = maxOrder;
  }
  return turns;
}

/** ref_ids of every Concept the trace can peek at (READ rows carry one). */
export function collectPeekRefIds(model: RunCascadeModel): string[] {
  const ids = new Set<string>();
  for (const agent of model.agents) {
    for (const row of agent.rows) {
      if (row.kind === "concept" && row.refId) ids.add(row.refId);
    }
  }
  return [...ids];
}

/**
 * A snapshot never updates, so nothing in it is "live": the pulsing head
 * and the running strip would only mislead a reader opening the file later.
 * Session statuses stay as recorded.
 */
function freeze(model: RunCascadeModel): RunCascadeModel {
  return {
    agents: model.agents.map((agent) => ({ ...agent, live: false })),
    summary: { ...model.summary, running: false },
  };
}

export async function assembleCascadeExport(
  access: CascadeAccess,
  now: () => Date = () => new Date(),
): Promise<CascadeExportPayload> {
  const source = access.useMocks ? mockSource(access) : liveSource(access);

  const { identifier, sessions: tops } = await source.listSessions();

  const byId = new Map<string, CascadeSession>();
  for (const s of tops) byId.set(s.id, s);
  for (const top of tops) {
    if (top.child_count <= 0) continue;
    for (const d of await source.descendantsOf(top)) {
      if (!byId.has(d.id)) byId.set(d.id, d);
    }
  }
  const all = [...byId.values()];

  const turnsBySession = new Map<string, CascadeTurn[]>();
  for (const session of all) {
    turnsBySession.set(session.id, await fetchAllTurns(source, session));
  }

  const model = freeze(assembleRunCascade(all, turnsBySession));

  const refIds = collectPeekRefIds(model);
  const peeks: Record<string, NodePeek> = {};
  let skippedPeeks: string[] = [];
  if (refIds.length > 0 && !access.useMocks) {
    const result = await prefetchNodePeeks(
      refIds,
      { swarmName: access.swarmName, swarmApiKey: access.apiKey },
      { maxIds: CASCADE_EXPORT_MAX_PEEKS, budgetMs: CASCADE_EXPORT_PEEK_BUDGET_MS },
    );
    for (const [id, peek] of result.peeks) peeks[id] = peek;
    skippedPeeks = result.skipped;
  }

  return {
    model,
    peeks,
    meta: {
      runId: access.runId,
      identifier,
      exportedAt: now().toISOString(),
      skippedPeeks,
    },
  };
}
