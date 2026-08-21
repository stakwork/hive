/**
 * Comment mutation commands.
 *
 * All functions return a new EditorState — no mutation.
 */

import { DocxComment } from "@/lib/docx-engine/types/document";
import { EditorState, applyDocChange } from "./editor-state";

let _commentSeq = 0;
function newCommentId(): string {
  return `comment-cmd-${Date.now()}-${++_commentSeq}`;
}

/**
 * Add a new comment anchored to a specific run.
 * The comment is appended to the doc's comments array.
 */
export function addComment(
  state: EditorState,
  author: string,
  anchorRunId: string,
  body: string
): EditorState {
  const comment: DocxComment = {
    id: newCommentId(),
    author,
    date: new Date().toISOString(),
    anchorText: anchorRunId, // store run ID as anchor reference
    body,
  };

  const newDoc = {
    ...state.doc,
    comments: [...state.doc.comments, comment],
  };

  return applyDocChange(state, newDoc);
}

/**
 * Remove a comment by ID.
 * Does not affect the document body runs that reference this comment.
 */
export function deleteComment(
  state: EditorState,
  commentId: string
): EditorState {
  const newDoc = {
    ...state.doc,
    comments: state.doc.comments.filter((c) => c.id !== commentId),
  };
  return applyDocChange(state, newDoc);
}

/**
 * Mark a comment as resolved by prefixing its body with a resolved flag.
 * In the absence of a first-class "resolved" field on DocxComment, we store
 * resolution state via a sentinel prefix so it survives export round-trips.
 *
 * If a richer resolution model is needed later, add `resolved?: boolean` to
 * DocxComment and migrate this implementation.
 */
export function resolveComment(
  state: EditorState,
  commentId: string
): EditorState {
  const RESOLVED_PREFIX = "[resolved] ";
  const newDoc = {
    ...state.doc,
    comments: state.doc.comments.map((c) =>
      c.id === commentId && !c.body.startsWith(RESOLVED_PREFIX)
        ? { ...c, body: RESOLVED_PREFIX + c.body }
        : c
    ),
  };
  return applyDocChange(state, newDoc);
}
