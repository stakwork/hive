import type { StreamToolCall } from "@/types/streaming";

export type ToolCallPhase = "running" | "complete" | "error";

/** Where a tool call is. Without an expected output, a call is done once its input has landed. */
export function toolCallPhase(toolCall: StreamToolCall, expectsOutput: boolean): ToolCallPhase {
  if (toolCall.status === "input-error" || toolCall.status === "output-error") return "error";
  if (toolCall.status === "output-available") return "complete";
  if (!expectsOutput && toolCall.status === "input-available") return "complete";
  return "running";
}

/**
 * A tool's name as words, sentence case. Underscores become spaces; a
 * `scope__` prefix — the workspace a tool is bound to — comes back
 * separately, except the `developer__` MCP prefix, which is noise:
 * `hive__list_concepts` is "List concepts" in "hive", `developer__read_file`
 * is "Read file".
 */
export function toolLabel(toolName: string): { name: string; scope: string | null } {
  const at = toolName.lastIndexOf("__");
  const raw = at === -1 ? toolName : toolName.slice(at + 2);
  const prefix = at === -1 ? null : toolName.slice(0, at);
  const scope = prefix && prefix !== "developer" ? prefix.replace(/_/g, " ").trim() : null;
  const words = raw.replace(/_/g, " ").trim();
  return { name: words.charAt(0).toUpperCase() + words.slice(1), scope };
}

export type ToolIconKey =
  | "web"
  | "graph"
  | "search"
  | "file"
  | "edit"
  | "docs"
  | "send"
  | "shell"
  | "logs"
  | "code"
  | "generic";

/** Singular keywords (a plural matches too); first match wins, so "web search" is web and "search code" is search. */
const ICON_KEYWORDS: [ToolIconKey, string[]][] = [
  ["web", ["web", "http", "url", "browse", "fetch", "html", "page"]],
  ["graph", ["graph", "neighbor", "walker", "node", "edge"]],
  ["search", ["search", "find", "query", "lookup", "grep", "clue"]],
  ["file", ["read", "file", "open", "cat", "view"]],
  ["edit", ["write", "edit", "create", "update", "patch", "replace", "delete", "remove"]],
  ["docs", ["concept", "learn", "doc", "documentation", "capability", "knowledge"]],
  ["send", ["send", "planner", "dispatch", "start", "run", "launch", "trigger", "task"]],
  ["shell", ["shell", "bash", "exec", "execute", "command", "terminal", "sh"]],
  ["logs", ["log"]],
  ["code", ["code", "repo", "git", "github", "pr", "pull", "commit", "diff"]],
];

const iconKeyByTool = new Map<string, ToolIconKey>();

/** Which glyph a tool gets, read off the words in its name; "generic" when none of them say. */
export function toolIconKey(toolName: string): ToolIconKey {
  const known = iconKeyByTool.get(toolName);
  if (known) return known;
  const words = new Set(
    toolLabel(toolName)
      .name.toLowerCase()
      .split(/[\s-]+/),
  );
  const key =
    ICON_KEYWORDS.find(([, keywords]) => keywords.some((k) => words.has(k) || words.has(`${k}s`)))?.[0] ?? "generic";
  iconKeyByTool.set(toolName, key);
  return key;
}

/** A value as JSON text for the raw view and the clipboard; strings stay as they are. */
export function toJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The call's input as a value: the parsed input when the stream delivered
 * one, else the streamed text parsed as JSON, else that text as it is.
 */
export function toolCallInput(toolCall: StreamToolCall): unknown {
  if (toolCall.input !== undefined) return toolCall.input;
  if (!toolCall.inputText) return undefined;
  try {
    return JSON.parse(toolCall.inputText);
  } catch {
    return toolCall.inputText;
  }
}

export function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TABLE_MAX_COLUMNS = 8;
const TABLE_MAX_ROWS = 200;

/**
 * The columns a table would have for this value: it is a non-empty list of
 * flat objects whose fields are all primitives and few enough to fit.
 * Null when a table would not suit it.
 */
export function tableColumns(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > TABLE_MAX_ROWS) return null;
  if (!value.every(isPlainObject)) return null;
  const columns: string[] = [];
  for (const row of value) {
    for (const [key, cell] of Object.entries(row)) {
      if (!isPrimitive(cell)) return null;
      if (!columns.includes(key)) columns.push(key);
    }
  }
  if (columns.length === 0 || columns.length > TABLE_MAX_COLUMNS) return null;
  return columns;
}
