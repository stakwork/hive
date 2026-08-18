/**
 * Map ai-sdk step content onto stakgraph session-ingest Turns.
 *
 * The wire contract is stakgraph's `POST /api/sessions/:id/turns`
 * (see `mcp/docs/session-ingest.md`). Chains built this way are
 * indistinguishable from the ones stakgraph's in-process emitter
 * writes, so the sessions UI renders a Jamie run exactly like a
 * `repo_agent` run.
 *
 * Pure + synchronous on purpose: `runCanvasAgent`'s `onStepFinish` is
 * awaited, so anything that runs there must not do I/O. The HTTP side
 * lives in `@/services/stakgraph-session-ingest`.
 */

/** Turn types the ingest API accepts. Mirrors `EXTERNAL_TURN_TYPES`. */
export type ExternalTurnType = "user_input" | "reasoning" | "tool_call" | "tool_result" | "response";

export interface ExternalTurnConcept {
  ref_id?: string;
  id?: string;
  repo?: string;
}

export interface ExternalTurn {
  turn_type: ExternalTurnType;
  content?: unknown;
  tool?: string;
  tool_call_id?: string;
  timestamp?: number;
  concepts?: ExternalTurnConcept[];
}

/**
 * Tools whose *result* carries a concept body — i.e. a real read. The
 * ingest doc is explicit that catalog listings (`list_concepts`,
 * `read_concepts_for_repo`, search) are NOT reads: recording them makes
 * every concept in the catalog look load-bearing. `runCanvasAgent` also
 * pre-seeds fake `list_concepts` call/result pairs into the prompt, so
 * including them here would additionally record reads that never
 * happened.
 */
const CONCEPT_READ_TOOLS = ["learn_concept", "read_concept_documentation"];

/**
 * Tool names arrive bare (`learn_concept`) in single-workspace mode and
 * namespaced (`{slug}__learn_concept`) in multi-workspace mode.
 */
function isConceptReadTool(toolName: string): boolean {
  return CONCEPT_READ_TOOLS.some((name) => toolName === name || toolName.endsWith(`__${name}`));
}

interface StepPart {
  type?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  input?: { conceptId?: string } & Record<string, unknown>;
  output?: unknown;
  result?: unknown;
}

/**
 * Resolve a concept identifier to the richest form the ingest API can
 * match on. `ref_id` wins when we have it — it's the graph node id, so
 * it needs no repo context. Otherwise fall back to the gitree id, plus
 * `repo` when the id is a bare slug (unprefixed ids only resolve with a
 * repo alongside them).
 *
 * `features` is `runCanvasAgent`'s pre-fetched concept catalog: the raw
 * gitree bodies, each carrying both `id` and `ref_id`.
 */
export function resolveConceptRef(
  conceptId: string,
  features: Record<string, unknown>[],
  repo?: string,
): ExternalTurnConcept {
  const match = features.find((f) => f.id === conceptId);
  const refId = match?.ref_id;
  if (typeof refId === "string" && refId) return { ref_id: refId };
  // Bare slugs (no `owner/repo/` prefix) only resolve when paired with
  // the repo they belong to.
  return conceptId.includes("/") || !repo ? { id: conceptId } : { id: conceptId, repo };
}

/** A tool result that reported an error is not a successful concept read. */
function isErrorOutput(output: unknown): boolean {
  return (
    !!output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { error?: unknown }).error === "string"
  );
}

/**
 * Convert one agent step's `content` array into Turns.
 *
 * Assistant text becomes `reasoning` — including the run's final answer,
 * which `/end` retypes to `response`. Tool calls carry
 * `JSON.stringify(input)`; tool results carry the raw output (stakgraph
 * wraps and truncates it to 100 chars on its side, matching in-process
 * sessions).
 *
 * Empty text parts are skipped: turns with no content are noise, and the
 * in-process emitter skips them too.
 *
 * @param features The turn's concept catalog, used to upgrade a
 *   `learn_concept` id to its graph `ref_id`.
 * @param repo `owner/repo` for the primary workspace, used to resolve
 *   bare concept slugs.
 */
export function turnsFromStepContent(
  content: unknown,
  features: Record<string, unknown>[] = [],
  repo?: string,
): ExternalTurn[] {
  if (!Array.isArray(content)) return [];

  // Pair concept reads to their results: the `conceptId` lives on the
  // tool-CALL part, but the read happened on the tool-RESULT part — the
  // turn edge marks the moment the body came back.
  const conceptIdByCallId = new Map<string, string>();
  for (const part of content as StepPart[]) {
    if (part?.type !== "tool-call") continue;
    const toolName = part.toolName || "";
    const conceptId = part.input?.conceptId;
    if (part.toolCallId && conceptId && isConceptReadTool(toolName)) {
      conceptIdByCallId.set(part.toolCallId, conceptId);
    }
  }

  const turns: ExternalTurn[] = [];
  for (const part of content as StepPart[]) {
    switch (part?.type) {
      case "text":
      case "reasoning": {
        const text = typeof part.text === "string" ? part.text.trim() : "";
        if (text) turns.push({ turn_type: "reasoning", content: text });
        break;
      }
      case "tool-call": {
        turns.push({
          turn_type: "tool_call",
          content: JSON.stringify(part.input ?? {}),
          tool: part.toolName || undefined,
          tool_call_id: part.toolCallId || undefined,
        });
        break;
      }
      case "tool-result": {
        // Adapters vary across SDK versions on `output` vs `result`.
        const output = part.output ?? part.result ?? null;
        const conceptId = part.toolCallId ? conceptIdByCallId.get(part.toolCallId) : undefined;
        const concepts =
          conceptId && !isErrorOutput(output) ? [resolveConceptRef(conceptId, features, repo)] : undefined;
        turns.push({
          turn_type: "tool_result",
          content: output,
          tool: part.toolName || undefined,
          tool_call_id: part.toolCallId || undefined,
          ...(concepts ? { concepts } : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return turns;
}

/**
 * Pull the latest user message text out of the model-message list, to
 * open the chain with a `user_input` turn.
 *
 * `ModelMessage.content` is either a plain string or an array of parts;
 * only the text parts belong in the turn (images and file parts have no
 * useful string form here).
 */
export function latestUserInput(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== "user") continue;
    if (typeof msg.content === "string") {
      const text = msg.content.trim();
      return text || undefined;
    }
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter(
          (p): p is { type: string; text: string } =>
            !!p &&
            typeof p === "object" &&
            (p as { type?: unknown }).type === "text" &&
            typeof (p as { text?: unknown }).text === "string",
        )
        .map((p) => p.text)
        .join("\n")
        .trim();
      return text || undefined;
    }
    return undefined;
  }
  return undefined;
}
