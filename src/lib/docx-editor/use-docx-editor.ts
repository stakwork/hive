"use client";

/**
 * useDocxEditor — React hook wrapping a single EditorState via useReducer.
 *
 * Returns [state, dispatch] where dispatch accepts any of the command
 * action objects defined below.
 */

import { useReducer } from "react";
import { EditorState, createEditorState } from "./editor-state";
import { DocxDocument } from "@/lib/docx-engine/types/document";
import { Selection } from "./selection";
import {
  insertText,
  deleteRange,
  acceptChange,
  rejectChange,
  acceptAllChanges,
  rejectAllChanges,
  setCharacterProperty,
  setParagraphProperty,
  undo,
  redo,
} from "./commands";
import { addComment, deleteComment, resolveComment } from "./comment-commands";
import { saveSnapshot, revertToSnapshot } from "./snapshot";
import { RunProperties, ParagraphProperties } from "@/lib/docx-engine/types/document";

// ─── Action union ─────────────────────────────────────────────────────────────

export type EditorAction =
  | { type: "SET_SELECTION"; selection: Selection | null }
  | { type: "INSERT_TEXT"; author: string; text: string }
  | { type: "DELETE_RANGE"; author: string }
  | { type: "ACCEPT_CHANGE"; changeId: string }
  | { type: "REJECT_CHANGE"; changeId: string }
  | { type: "ACCEPT_ALL_CHANGES" }
  | { type: "REJECT_ALL_CHANGES" }
  | { type: "SET_CHARACTER_PROPERTY"; prop: keyof RunProperties; value: RunProperties[keyof RunProperties] }
  | { type: "SET_PARAGRAPH_PROPERTY"; prop: keyof ParagraphProperties; value: ParagraphProperties[keyof ParagraphProperties] }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "ADD_COMMENT"; author: string; anchorRunId: string; body: string }
  | { type: "DELETE_COMMENT"; commentId: string }
  | { type: "RESOLVE_COMMENT"; commentId: string }
  | { type: "SAVE_SNAPSHOT"; label: string }
  | { type: "REVERT_TO_SNAPSHOT"; snapshotId: string };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_SELECTION":
      return { ...state, selection: action.selection };
    case "INSERT_TEXT":
      return insertText(state, action.author, action.text);
    case "DELETE_RANGE":
      return deleteRange(state, action.author);
    case "ACCEPT_CHANGE":
      return acceptChange(state, action.changeId);
    case "REJECT_CHANGE":
      return rejectChange(state, action.changeId);
    case "ACCEPT_ALL_CHANGES":
      return acceptAllChanges(state);
    case "REJECT_ALL_CHANGES":
      return rejectAllChanges(state);
    case "SET_CHARACTER_PROPERTY":
      return setCharacterProperty(state, action.prop, action.value);
    case "SET_PARAGRAPH_PROPERTY":
      return setParagraphProperty(state, action.prop, action.value);
    case "UNDO":
      return undo(state);
    case "REDO":
      return redo(state);
    case "ADD_COMMENT":
      return addComment(state, action.author, action.anchorRunId, action.body);
    case "DELETE_COMMENT":
      return deleteComment(state, action.commentId);
    case "RESOLVE_COMMENT":
      return resolveComment(state, action.commentId);
    case "SAVE_SNAPSHOT":
      return saveSnapshot(state, action.label);
    case "REVERT_TO_SNAPSHOT":
      return revertToSnapshot(state, action.snapshotId);
    default:
      return state;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDocxEditor(
  initialDoc: DocxDocument
): [EditorState, React.Dispatch<EditorAction>] {
  return useReducer(reducer, initialDoc, createEditorState);
}
