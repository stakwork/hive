/**
 * Which engine answers the org canvas chat (Jamie) for a source-control
 * org — an org-level setting a person flips in the org settings UI
 * (`JamieEngineSettings`), stored on `SourceControlOrg.jamieEngine`.
 *
 *   - `hive`  — today's canvas agent (`runCanvasAgent`): its tools, cards
 *               and approval flow, exactly as they are. The default.
 *   - `strut` — the swarm strut's `orchestrator` workflow, one run per
 *               message (`services/strut-orchestrator.ts`): strut's agent
 *               remembers the conversation through its session, its graph
 *               writes come back as PROPOSALS a person decides on the card
 *               (`StrutProposalCard`). An OPTION beside the default, never a
 *               replacement.
 *
 * Read once per request by the chat route (`/api/ask/quick`). Fails to
 * `hive`: a missing org, an unknown value or a lookup error all leave the
 * default path exactly as it is.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const JAMIE_ENGINES = ["hive", "strut"] as const;
export type JamieEngine = (typeof JAMIE_ENGINES)[number];
export const DEFAULT_JAMIE_ENGINE: JamieEngine = "hive";

/** The stored value as an engine; anything else is the default. */
export function parseJamieEngine(value: unknown): JamieEngine {
  return typeof value === "string" && (JAMIE_ENGINES as readonly string[]).includes(value)
    ? (value as JamieEngine)
    : DEFAULT_JAMIE_ENGINE;
}

/** Whether a value a person submitted names an engine. */
export function isJamieEngine(value: unknown): value is JamieEngine {
  return typeof value === "string" && (JAMIE_ENGINES as readonly string[]).includes(value);
}

/**
 * The engine for the org (`SourceControlOrg.id`, the `orgId` the chat route
 * carries). Fails closed to `hive`.
 */
export async function jamieEngineForOrg(orgId: string | null | undefined): Promise<JamieEngine> {
  if (!orgId) return DEFAULT_JAMIE_ENGINE;
  try {
    const org = await db.sourceControlOrg.findUnique({ where: { id: orgId }, select: { jamieEngine: true } });
    return parseJamieEngine(org?.jamieEngine);
  } catch (err) {
    logger.error("[jamieEngine] org lookup failed — using the default engine", "jamieEngine", {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_JAMIE_ENGINE;
  }
}
