import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { useCanvasChatStore } from "../../_state/canvasChatStore";

/** `Verb B: "<text>" (<ref_id>)`; no label for the root or a follow-up question. */
const draft = (verb: string, c: Pick<ChoiceItem, "letter" | "name" | "id">) =>
  `${verb} ${c.letter ? `${c.letter}: ` : ""}"${c.name}" (${c.id})`;

export const goWithDraft = (c: ChoiceItem) => draft("Go with", c);
export const deselectDraft = (c: ChoiceItem) => draft("Deselect", c);
export const dropDraft = (c: ChoiceItem) => draft("Drop", c);
export const reopenDraft = (c: ChoiceItem) => draft("Reopen", c);
export const expandDraft = (c: ChoiceItem) => draft("Expand", c);

/** What the brainstorm job does for the person: drafted into Jamie's chat, applied when they send it. */
export type BoardAction = "go-with" | "deselect" | "drop" | "reopen" | "expand";
/** What the person writes on the desk themselves, in pencil until Save. */
export type PencilAction = "add-option" | "follow-up" | "edit" | "discard";
export type DeskAction = BoardAction | PencilAction;

export const isBoardAction = (a: DeskAction): a is BoardAction =>
  a === "go-with" || a === "deselect" || a === "drop" || a === "reopen" || a === "expand";

/**
 * Puts a message in the chat composer — nothing is sent. Go with is appended
 * (several make one message); the others replace what was there.
 */
export function composeFor(action: BoardAction, c: ChoiceItem) {
  const { appendPendingInputDraft, setPendingInputDraft } = useCanvasChatStore.getState();
  const text = {
    "go-with": goWithDraft,
    deselect: deselectDraft,
    drop: dropDraft,
    reopen: reopenDraft,
    expand: expandDraft,
  }[action](c);
  if (action === "go-with") appendPendingInputDraft(text);
  else setPendingInputDraft(text);
}

/**
 * The actions a card offers, the first being the main one. An unsaved card
 * offers only pencil actions; a person's saved card can be rewritten.
 */
export function cardActions(
  item: ChoiceItem,
  opts: { pencil: boolean; person: boolean },
): Array<{ action: DeskAction; label: string }> {
  if (opts.pencil) {
    return [
      ...(item.isQuestion
        ? [{ action: "add-option" as const, label: "+ Option" }]
        : [{ action: "follow-up" as const, label: "Ask a follow-up" }]),
      { action: "edit", label: "Edit" },
      { action: "discard", label: "Discard" },
    ];
  }
  const edit = opts.person ? [{ action: "edit" as const, label: "Edit" }] : [];
  if (item.isQuestion) {
    return [
      { action: "add-option", label: "+ Option" },
      { action: "expand", label: "Ask Jamie for options" },
      ...(item.state === "decided" ? [{ action: "reopen" as const, label: "Reopen" }] : []),
      ...edit,
    ];
  }
  switch (item.state) {
    case "chosen":
      return [
        { action: "follow-up", label: "Ask a follow-up" },
        { action: "expand", label: "Expand" },
        { action: "deselect", label: "Deselect" },
        ...edit,
      ];
    case "rejected":
      return [{ action: "reopen", label: "Reopen" }];
    case "simulated":
      return [
        { action: "go-with", label: "Go with" },
        { action: "drop", label: "Drop" },
      ];
    default:
      return [
        { action: "go-with", label: "Go with" },
        { action: "expand", label: "Expand" },
        { action: "follow-up", label: "Ask a follow-up" },
        { action: "drop", label: "Drop" },
        ...edit,
      ];
  }
}
