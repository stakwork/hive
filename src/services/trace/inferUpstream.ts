/**
 * When no step's output holds the selection verbatim (`matchUpstream`
 * found nothing — the value is one the model computed, summarized, or
 * reworded), ask a model to rank the candidate steps instead. Links made
 * this way are always `"inferred"`, never `"exact"`: a value the model
 * computed can only ever be a guess at its source.
 *
 * Best-effort: any failure (no key, the model, a bad response) returns no
 * links rather than throwing — a trace with no inferred links still
 * renders, with the gap logged by the caller.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { getApiKeyForProvider, getModel } from "@/lib/ai/provider";
import type { TraceLink } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { traceLog } from "./log";
import type { TraceSourceStep } from "./types";

/** How many of the most recent candidate steps are shown to the model — token budget, not a hard trace limit. */
const MAX_CANDIDATES = 30;
const CANDIDATE_EXCERPT = 500;
const LINK_EXCERPT = 500;

const picksSchema = z.object({
  picks: z
    .array(z.object({ index: z.number().int(), reason: z.string() }))
    .max(3)
    .describe("Candidates most likely to have produced the selection, best first"),
});

export async function inferUpstream(selection: string, steps: TraceSourceStep[], beforeOrder = Infinity): Promise<TraceLink[]> {
  const candidates = steps.filter((step) => step.order < beforeOrder).slice(-MAX_CANDIDATES);
  if (candidates.length === 0) return [];
  try {
    const apiKey = getApiKeyForProvider("anthropic");
    const model = getModel("anthropic", apiKey);
    const prompt = [
      `A user highlighted this text in an agent's output:`,
      ``,
      `"""${selection}"""`,
      ``,
      `Which of these steps most likely produced it — directly, or by computing, summarizing or rewording it? List at most 3, best first.`,
      ``,
      ...candidates.map((step, i) => `[${i}] ${step.toolName}: ${step.output.slice(0, CANDIDATE_EXCERPT)}`),
    ].join("\n");
    const { object } = await generateObject({ model, schema: picksSchema, prompt });
    return object.picks
      .map((pick) => candidates[pick.index])
      .filter((step): step is TraceSourceStep => step !== undefined)
      .map((step) => ({
        toolCallId: step.toolCallId,
        path: step.path,
        toolName: step.toolName,
        excerpt: step.output.length > LINK_EXCERPT ? `${step.output.slice(0, LINK_EXCERPT)}…` : step.output,
        match: "inferred" as const,
        ...(step.nodes && step.nodes.length > 0 ? { nodes: step.nodes } : {}),
      }));
  } catch (err) {
    traceLog.warn("inference fallback failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
