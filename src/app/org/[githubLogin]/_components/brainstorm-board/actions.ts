import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { useCanvasChatStore } from "../../_state/canvasChatStore";

/** `Verb B: "<text>" (<ref_id>)`; no label for the root or a follow-up question. */
const draft = (verb: string, c: Pick<ChoiceItem, "letter" | "name" | "id">) =>
  `${verb} ${c.letter ? `${c.letter}: ` : ""}"${c.name}" (${c.id})`;

export const goWithDraft = (c: ChoiceItem) => draft("Go with", c);
export const deselectDraft = (c: ChoiceItem) => draft("Deselect", c);
export const expandDraft = (c: ChoiceItem) => draft("Expand", c);
/** Left open for the user to type the idea after it. */
export const addIdeaDraft = (c: ChoiceItem) => `Add an option under ${c.letter ?? `"${c.name}"`}: `;

export type BoardAction = "go-with" | "expand" | "deselect" | "add-idea";

/**
 * Puts a message in the chat composer — nothing is sent. Go with is appended
 * (several make one message); the others replace what was there.
 */
export function composeFor(action: BoardAction, c: ChoiceItem) {
  const { appendPendingInputDraft, setPendingInputDraft } = useCanvasChatStore.getState();
  if (action === "go-with") appendPendingInputDraft(goWithDraft(c));
  else if (action === "expand") setPendingInputDraft(expandDraft(c));
  else if (action === "deselect") setPendingInputDraft(deselectDraft(c));
  else setPendingInputDraft(addIdeaDraft(c));
}
