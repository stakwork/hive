/**
 * EditorState — the single source of truth for one open document.
 *
 * All command functions return a *new* EditorState; nothing is mutated.
 */

import { DocxDocument } from "@/lib/docx-engine/types/document";
import { Selection } from "./selection";
import { Snapshot } from "./snapshot";

export interface EditorState {
  /** The current document (immutable — commands produce new copies). */
  doc: DocxDocument;
  /** Current caret / selection within the document. May be null when unfocused. */
  selection: Selection | null;
  /** Past document states for undo (most-recent last). */
  history: DocxDocument[];
  /** Future document states for redo (most-recent last relative to current). */
  future: DocxDocument[];
  /** Named snapshots saved by the user. */
  snapshots: Snapshot[];
}

/** Construct a fresh EditorState from a parsed DocxDocument. */
export function createEditorState(doc: DocxDocument): EditorState {
  return {
    doc,
    selection: null,
    history: [],
    future: [],
    snapshots: [],
  };
}

/**
 * Helper used by every mutating command:
 * pushes the *current* doc onto the history stack, clears the redo stack,
 * and returns a new state with the updated doc.
 */
export function applyDocChange(
  state: EditorState,
  newDoc: DocxDocument
): EditorState {
  return {
    ...state,
    doc: newDoc,
    history: [...state.history, state.doc],
    future: [],
  };
}
