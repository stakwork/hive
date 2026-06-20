/**
 * In-memory text editor for the scorer self-improvement agent.
 *
 * Adapted from a filesystem-backed implementation of Anthropic's
 * `str_replace_based_edit_tool`. Instead of reading/writing real files, it
 * operates on a single in-memory document (a workspace description) and
 * RECORDS each mutation as a proposed edit rather than persisting it.
 *
 * The recorded edits are exact `{ oldStr -> newStr }` replacements so that,
 * on approval, they can be re-applied with `str_replace` semantics against
 * the *live* DB value (rejecting the proposal if the value drifted).
 */

const VIEW_MAX_CHARS = 200_000;

export interface TextEditInput {
  command: "view" | "create" | "str_replace" | "insert";
  path: string;
  file_text?: string;
  insert_line?: number;
  new_str?: string;
  insert_text?: string;
  old_str?: string;
  view_range?: number[];
}

/**
 * A single exact replacement. `oldStr === ""` means "only valid when the
 * document is currently empty" (initial authoring of a blank description).
 */
export interface ProposedEdit {
  command: "create" | "str_replace" | "insert";
  oldStr: string;
  newStr: string;
}

export interface InMemoryEditor {
  /** Run one text-editor command; returns the model-facing result string. */
  exec(input: TextEditInput): string;
  /** Current working copy after all applied edits. */
  getContent(): string;
  /** Ordered list of recorded edits to replay on approval. */
  getEdits(): ProposedEdit[];
}

/**
 * Create an editor bound to one virtual document. `path` on each command is
 * accepted (the tool requires it) but ignored — there is a single document.
 */
export function createInMemoryEditor(initialContent: string): InMemoryEditor {
  let content = initialContent ?? "";
  const edits: ProposedEdit[] = [];

  function view(input: TextEditInput): string {
    if (content.length === 0) return "(empty file)";
    const lines = content.split("\n");
    let start = 1;
    let end = lines.length;
    if (Array.isArray(input.view_range) && input.view_range.length === 2) {
      start = Math.max(1, input.view_range[0]);
      end = input.view_range[1] === -1 ? lines.length : input.view_range[1];
    }
    const out = lines
      .slice(start - 1, end)
      .map((l, i) => `${start + i}: ${l}`)
      .join("\n");
    return out.length > VIEW_MAX_CHARS
      ? out.slice(0, VIEW_MAX_CHARS) + "\n\n[... output truncated ...]"
      : out;
  }

  return {
    exec(input: TextEditInput): string {
      switch (input.command) {
        case "view":
          return view(input);

        case "create": {
          // Authoring/replacing the whole document.
          const next = input.file_text ?? "";
          edits.push({ command: "create", oldStr: content, newStr: next });
          content = next;
          return "Successfully wrote document.";
        }

        case "str_replace": {
          const old = input.old_str ?? "";
          const count = old ? content.split(old).length - 1 : 0;
          if (count === 0)
            return "Error: No match found for replacement. Please check your text and try again.";
          if (count > 1)
            return `Error: Found ${count} matches for replacement text. Please provide more context to make a unique match.`;
          const next = input.new_str ?? "";
          edits.push({ command: "str_replace", oldStr: old, newStr: next });
          content = content.replace(old, next);
          return "Successfully replaced text at exactly one location.";
        }

        case "insert": {
          const lines = content.split("\n");
          const at = input.insert_line ?? 0;
          if (at < 0 || at > lines.length)
            return `Error: insert_line ${at} is out of range (0-${lines.length})`;
          const text = input.new_str ?? input.insert_text ?? "";

          // Represent the insertion as an anchored, exact replacement so it
          // can be re-applied via str_replace on the live value.
          if (content.length === 0) {
            edits.push({ command: "insert", oldStr: "", newStr: text });
            content = text;
            return "Successfully inserted text into empty document.";
          }
          if (at === 0) {
            const anchor = lines[0];
            edits.push({
              command: "insert",
              oldStr: anchor,
              newStr: `${text}\n${anchor}`,
            });
          } else {
            const anchor = lines[at - 1];
            edits.push({
              command: "insert",
              oldStr: anchor,
              newStr: `${anchor}\n${text}`,
            });
          }
          lines.splice(at, 0, text);
          content = lines.join("\n");
          return `Successfully inserted text after line ${at}.`;
        }

        default:
          return `Error: unknown command "${(input as { command?: string }).command}"`;
      }
    },
    getContent: () => content,
    getEdits: () => edits,
  };
}

/**
 * Re-apply a recorded edit against a live value with exact `str_replace`
 * semantics. Returns the new value, or `null` if the edit no longer applies
 * cleanly (stale / conflicting — i.e. not exactly one match).
 */
export function applyEdit(live: string, edit: ProposedEdit): string | null {
  if (edit.oldStr === "") {
    // Initial authoring: only valid if the doc is still empty.
    return live.length === 0 ? edit.newStr : null;
  }
  if (edit.command === "create") {
    // Whole-document replacement: require the prior full value to match.
    return live === edit.oldStr ? edit.newStr : null;
  }
  const count = live.split(edit.oldStr).length - 1;
  if (count !== 1) return null;
  return live.replace(edit.oldStr, edit.newStr);
}
