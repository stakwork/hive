import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { useCanvasChatStore } from "../../_state/canvasChatStore";

/**
 * v1 assumption: clicking an option only COMPOSES the message in the chat
 * input and the user presses Send. Flipping this to true is not wired to the
 * send hook yet — `compose` calls `onSend` when it is set.
 */
export const SEND_ON_CLICK = false;

/** `Verb B: "<text>" (<ref_id>)`; no label for the root or a follow-up question. */
const draft = (verb: string, c: Pick<ChoiceItem, "letter" | "name" | "id">) =>
  `${verb} ${c.letter ? `${c.letter}: ` : ""}"${c.name}" (${c.id})`;

export const goWithDraft = (c: ChoiceItem) => draft("Go with", c);
export const deselectDraft = (c: ChoiceItem) => draft("Deselect", c);
export const expandDraft = (c: ChoiceItem) => draft("Expand", c);

/** What clicking a node composes: Go with for an option, Deselect for a chosen one, nothing for a question. */
export function clickDraft(c: ChoiceItem): string | null {
  if (c.isQuestion) return null;
  return c.state === "chosen" ? deselectDraft(c) : goWithDraft(c);
}

/** Puts a message in the chat composer: appended (several clicks make one message) or replacing. */
export function compose(text: string, mode: "append" | "replace", onSend?: (text: string) => void) {
  const { appendPendingInputDraft, setPendingInputDraft } = useCanvasChatStore.getState();
  (mode === "append" ? appendPendingInputDraft : setPendingInputDraft)(text);
  if (SEND_ON_CLICK) onSend?.(text);
}
