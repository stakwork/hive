/**
 * What a dispatched strut chat did, read off its transcript: the workflows
 * its builder published and the runs it launched. Shown on the chat's card
 * in the canvas conversation (`StrutChatCard`), each with its own link.
 *
 * Pure: the transcript is strut's `GET /chat/:id` `messages` — AI SDK model
 * messages, where a tool call is an assistant part and its result a `tool`
 * part carrying `{ type: "json", value }`. Only three of the builder's tools
 * are read (`create_workflow`, `edit_workflow`, `run_workflow`); names and
 * ids are the only things kept, never a tool's input or output.
 */

export type StrutChatWorkflowAction = "created" | "edited";

export interface StrutChatWorkflow {
  name: string;
  /** The latest version this chat published, e.g. `v3`. */
  version?: string;
  /** `created` when this chat published the workflow's first version. */
  action: StrutChatWorkflowAction;
}

/** `stale`: strut no longer tracks the run (it restarted mid-run). */
export type StrutChatRunStatus = "running" | "success" | "error" | "cancelled" | "stale";

export interface StrutChatRun {
  workflow: string;
  runId: string;
  status: StrutChatRunStatus;
}

export interface StrutChatActivity {
  workflows: StrutChatWorkflow[];
  runs: StrutChatRun[];
}

/** The newest of each that a card keeps. */
export const MAX_STRUT_CHAT_WORKFLOWS = 10;
export const MAX_STRUT_CHAT_RUNS = 10;

const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const MAX_VERSION_LENGTH = 32;

const bounded = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

/**
 * A run's status as strut words it: a finished run's own, a live one's
 * controller state (`pausing`, `paused`, `cancelling` are still in flight),
 * or `stale`. Anything else reads as `fallback`.
 */
export function toStrutChatRunStatus(raw: unknown, fallback: StrutChatRunStatus = "running"): StrutChatRunStatus {
  switch (raw) {
    case "success":
    case "error":
    case "cancelled":
    case "stale":
    case "running":
      return raw;
    case "pausing":
    case "paused":
    case "cancelling":
      return "running";
    default:
      return fallback;
  }
}

type Part = { type?: unknown; toolCallId?: unknown; toolName?: unknown; input?: unknown; output?: unknown };

const partsOf = (message: unknown): Part[] => {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? (content.filter((p) => p && typeof p === "object") as Part[]) : [];
};

/** The workflows and runs of a strut transcript, oldest first. */
export function projectStrutChatActivity(messages: unknown): StrutChatActivity {
  const workflows = new Map<string, StrutChatWorkflow>();
  const runs = new Map<string, StrutChatRun>();
  if (!Array.isArray(messages)) return { workflows: [], runs: [] };

  // A result names its tool but not what it was called with.
  const inputs = new Map<string, unknown>();

  for (const message of messages) {
    for (const part of partsOf(message)) {
      if (typeof part.toolCallId !== "string") continue;
      if (part.type === "tool-call") {
        inputs.set(part.toolCallId, part.input);
        continue;
      }
      if (part.type !== "tool-result") continue;
      const output = part.output as { type?: unknown; value?: unknown } | null | undefined;
      if (output?.type !== "json" || !output.value || typeof output.value !== "object") continue;
      const value = output.value as Record<string, unknown>;
      const input = (inputs.get(part.toolCallId) ?? {}) as Record<string, unknown>;

      if (part.toolName === "create_workflow" || part.toolName === "edit_workflow") {
        const name = bounded(value.name, MAX_NAME_LENGTH);
        // `changed: false` is an edit that published nothing.
        if (value.ok !== true || !name || value.changed === false) continue;
        const version = bounded(value.version, MAX_VERSION_LENGTH);
        const created = part.toolName === "create_workflow" || workflows.get(name)?.action === "created";
        // Re-inserted, so the order tracks the latest touch.
        workflows.delete(name);
        workflows.set(name, { name, ...(version ? { version } : {}), action: created ? "created" : "edited" });
        continue;
      }

      if (part.toolName === "run_workflow") {
        const runId = bounded(value.runId, MAX_ID_LENGTH);
        const workflow = bounded(value.workflow, MAX_NAME_LENGTH) ?? bounded(input.name, MAX_NAME_LENGTH);
        if (!runId || !workflow) continue;
        runs.delete(runId);
        runs.set(runId, { workflow, runId, status: toStrutChatRunStatus(value.status) });
      }
    }
  }

  return {
    workflows: [...workflows.values()].slice(-MAX_STRUT_CHAT_WORKFLOWS),
    runs: [...runs.values()].slice(-MAX_STRUT_CHAT_RUNS),
  };
}

/**
 * An activity as it comes back out of stored JSON (a conversation row's
 * `source.activity`): the same bounds as the projection, anything
 * malformed dropped. Null when there is nothing to read.
 */
export function parseStrutChatActivity(raw: unknown): StrutChatActivity | null {
  if (!raw || typeof raw !== "object") return null;
  const { workflows, runs } = raw as { workflows?: unknown; runs?: unknown };
  const out: StrutChatActivity = { workflows: [], runs: [] };
  for (const w of Array.isArray(workflows) ? workflows : []) {
    const name = bounded(w?.name, MAX_NAME_LENGTH);
    if (!name) continue;
    const version = bounded(w?.version, MAX_VERSION_LENGTH);
    out.workflows.push({
      name,
      ...(version ? { version } : {}),
      action: w?.action === "created" ? "created" : "edited",
    });
  }
  for (const r of Array.isArray(runs) ? runs : []) {
    const workflow = bounded(r?.workflow, MAX_NAME_LENGTH);
    const runId = bounded(r?.runId, MAX_ID_LENGTH);
    if (!workflow || !runId) continue;
    out.runs.push({ workflow, runId, status: toStrutChatRunStatus(r?.status) });
  }
  out.workflows = out.workflows.slice(-MAX_STRUT_CHAT_WORKFLOWS);
  out.runs = out.runs.slice(-MAX_STRUT_CHAT_RUNS);
  return out;
}
