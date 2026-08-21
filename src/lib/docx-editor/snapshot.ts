/**
 * Named document snapshots (session-local; not persisted across page reloads).
 */

import { DocxDocument } from "@/lib/docx-engine/types/document";
import { EditorState } from "./editor-state";

export interface Snapshot {
  id: string;
  label: string;
  timestamp: string; // ISO 8601
  doc: DocxDocument;
}

function makeSnapshotId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Save a named snapshot of the current document state.
 * Does NOT push to the undo history — it's a parallel versioning mechanism.
 */
export function saveSnapshot(state: EditorState, label: string): EditorState {
  const snapshot: Snapshot = {
    id: makeSnapshotId(),
    label: label.trim() || "Snapshot",
    timestamp: new Date().toISOString(),
    doc: state.doc,
  };
  return {
    ...state,
    snapshots: [...state.snapshots, snapshot],
  };
}

/**
 * Revert the document to the state captured in a given snapshot.
 * The current document is pushed onto the undo history first so the
 * revert is itself undoable.
 */
export function revertToSnapshot(
  state: EditorState,
  snapshotId: string
): EditorState {
  const snap = state.snapshots.find((s) => s.id === snapshotId);
  if (!snap) return state;

  return {
    ...state,
    doc: snap.doc,
    history: [...state.history, state.doc],
    future: [],
  };
}
