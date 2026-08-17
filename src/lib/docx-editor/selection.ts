/**
 * Selection model for the DOCX editor.
 *
 * Mirrors the browser Selection API semantics but operates on run IDs
 * rather than DOM nodes, so it remains decoupled from any rendering layer.
 */

export interface Selection {
  /** ID of the run where the selection starts */
  anchorRunId: string;
  /** Character offset within the anchor run */
  anchorOffset: number;
  /** ID of the run where the selection ends */
  focusRunId: string;
  /** Character offset within the focus run */
  focusOffset: number;
}

/** A collapsed (zero-length) selection at the given run/offset. */
export function collapsed(runId: string, offset: number): Selection {
  return { anchorRunId: runId, anchorOffset: offset, focusRunId: runId, focusOffset: offset };
}

/** Returns true when anchor === focus (caret, no range selected). */
export function isCollapsed(sel: Selection): boolean {
  return sel.anchorRunId === sel.focusRunId && sel.anchorOffset === sel.focusOffset;
}
