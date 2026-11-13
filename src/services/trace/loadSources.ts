/**
 * The candidate sources a trace searches: a Jamie conversation's rows, and
 * a strut run's events — plus their full outputs, when the run has them
 * (the strut capture task's `outputRef`). When a Jamie tool output holds a
 * strut `runId`, the caller may pass a `followStrutRun` loader and this
 * follows the hand-off, splicing that run's steps in right after the tool
 * call that reported it.
 */

import { toJsonText } from "@/components/streaming/toolCallValue";
import { traceLog } from "./log";
import type { TraceSourceStep } from "./types";

export interface JamieToolCallLike {
  id: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
}

export interface JamieMessageLike {
  id: string;
  role: string;
  content?: string;
  toolCalls?: JamieToolCallLike[];
}

/** A strut `runId` a tool call's own output named, when it handed off into a run. */
function runIdOf(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const value = (output as Record<string, unknown>).runId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type FollowStrutRun = (runId: string) => Promise<TraceSourceStep[] | null>;

/**
 * Every step a Jamie conversation's rows hold, oldest first: a message's
 * own text (role named as its "tool") and each of its tool calls, in the
 * order the rows stored them. A tool call whose output names a strut
 * `runId` has that run's steps spliced in right after it, when `followStrutRun`
 * resolves one — so a selection made inside a job's run still traces back
 * through the hand-off.
 */
export async function loadJamieSources(
  messages: JamieMessageLike[],
  followStrutRun?: FollowStrutRun,
): Promise<TraceSourceStep[]> {
  const steps: TraceSourceStep[] = [];
  for (const message of messages) {
    if (message.content && message.content.trim()) {
      steps.push({
        key: message.id,
        toolName: `${message.role} message`,
        input: "",
        output: message.content,
        order: steps.length,
      });
    }
    for (const call of message.toolCalls ?? []) {
      steps.push({
        key: call.id,
        toolCallId: call.id,
        toolName: call.toolName,
        input: toJsonText(call.input ?? ""),
        output: toJsonText(call.output ?? ""),
        order: steps.length,
      });
      const runId = runIdOf(call.output);
      if (runId && followStrutRun) {
        const spliced = await followStrutRun(runId);
        if (spliced && spliced.length > 0) {
          for (const step of spliced) steps.push({ ...step, order: steps.length });
        } else if (spliced === null) {
          traceLog.info("strut hand-off could not be read", { runId });
        }
      }
    }
  }
  return steps;
}

/** A strut event, loosely — only `step.end` rows become steps; `step.start` only feeds an end its input. */
interface RawStrutEvent {
  type?: string;
  path?: string;
  stepType?: string;
  toolCallId?: string;
  outputRef?: string;
  input?: unknown;
  output?: unknown;
  nodes?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TOOL_PREFIX = "tool:";

/** A step's own name, without strut's `tool:` prefix for a call an agent made — `graph/graph-get`, not `tool:graph/graph-get`. */
function toolNameOf(stepType: string): string {
  return stepType.startsWith(TOOL_PREFIX) ? stepType.slice(TOOL_PREFIX.length) : stepType;
}

function nodesOf(value: unknown): { ref_id: string; node_type?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const nodes = value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.ref_id !== "string") return [];
    return [{ ref_id: entry.ref_id, ...(typeof entry.node_type === "string" ? { node_type: entry.node_type } : {}) }];
  });
  return nodes.length > 0 ? nodes : undefined;
}

/**
 * Every `step.end` of a strut run's events, oldest first — its own path
 * for `path`, and its `toolCallId` when the event carried one (the strut
 * capture task). `fullOutputs` keys the full-length output text by
 * `outputRef`, for events whose preview was cut short; an event without a
 * resolved full output falls back to its preview.
 */
export function buildStrutSteps(events: unknown[], fullOutputs: Map<string, string> = new Map()): TraceSourceStep[] {
  const starts = new Map<string, unknown>();
  const steps: TraceSourceStep[] = [];
  for (const raw of events) {
    if (!isRecord(raw) || typeof raw.path !== "string") continue;
    const event = raw as RawStrutEvent;
    if (event.type === "step.start") {
      starts.set(event.path!, event.input);
      continue;
    }
    if (event.type !== "step.end") continue;
    const toolName = toolNameOf(event.stepType ?? "step");
    const full = event.outputRef ? fullOutputs.get(event.outputRef) : undefined;
    steps.push({
      key: event.path!,
      path: event.path,
      toolCallId: event.toolCallId,
      toolName,
      input: toJsonText(starts.get(event.path!) ?? ""),
      output: full ?? toJsonText(event.output ?? ""),
      nodes: nodesOf(event.nodes),
      order: steps.length,
    });
  }
  return steps;
}
