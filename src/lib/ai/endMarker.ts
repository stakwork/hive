import type { StepResult, ToolSet } from "ai";

/**
 * The "[END_OF_ANSWER]" turn-end protocol marker, anchored to the end of a
 * text. Only trailing whitespace may follow it.
 *
 * The canvas agent's prompt ends every answer with the marker (see
 * `@/lib/constants/prompt`), and providers that don't enforce
 * `stopSequences` server-side leak it into visible text. It is a protocol
 * token only when it *ends* the text: an agent working on Hive or stakgraph
 * quotes the marker while describing the code that handles it ("... after
 * the `[END_OF_ANSWER]` strip ..."), and an unanchored `includes` or global
 * replace turned that into an early stop or a mangled answer. Mirrors
 * `TRAILING_END_MARKER` in stakgraph's `mcp/src/repo/utils.ts`.
 */
export const TRAILING_END_MARKER = /\[END_OF_ANSWER\]\s*$/;

/** True when `text` ends with the marker (trailing whitespace allowed). */
export function endsWithEndMarker(text: string | null | undefined): boolean {
  return !!text && TRAILING_END_MARKER.test(text);
}

/**
 * Remove a trailing marker. A marker quoted mid-text is content and stays.
 * Does not trim: streaming callers re-render on every delta, and leading /
 * trailing whitespace is layout there. Callers that persist trim themselves.
 */
export function stripEndMarker(text: string): string {
  return text.replace(TRAILING_END_MARKER, "");
}

/** A step's text parts concatenated in order (reasoning and tool parts skipped). */
function stepText<T extends ToolSet>(step: StepResult<T>): string {
  let out = "";
  for (const item of step.content) {
    if (item.type === "text" && item.text) out += item.text;
  }
  return out;
}

/** True when some step's text ends with the marker: the model terminated its turn. */
export function hasTrailingEndMarker<T extends ToolSet>(steps: StepResult<T>[]): boolean {
  return steps.some((step) => endsWithEndMarker(stepText(step)));
}
