/**
 * Immutable document command functions.
 *
 * Every function takes an EditorState and returns a NEW EditorState.
 * Nothing is mutated. The author string is stored as-is; XML escaping
 * is the responsibility of the exporter layer (track-change-exporter.ts).
 */

import {
  DocxDocument,
  DocxBlock,
  DocxParagraph,
  DocxInlineNode,
  DocxTextRun,
  RunProperties,
  ParagraphProperties,
} from "@/lib/docx-engine/types/document";
import {
  TrackChangeMark,
  TrackChangeType,
  TrackChangeStatus,
} from "@/lib/docx-engine/types/track-changes";
import { EditorState, applyDocChange } from "./editor-state";
import { isCollapsed } from "./selection";

// ─── ID helpers ───────────────────────────────────────────────────────────────

let _runSeq = 0;
function newRunId(): string {
  return `run-cmd-${Date.now()}-${++_runSeq}`;
}

let _changeSeq = 0;
function newChangeId(): string {
  return `tc-${Date.now()}-${++_changeSeq}`;
}

// ─── Deep-clone helpers ───────────────────────────────────────────────────────

function cloneRun(run: DocxInlineNode): DocxInlineNode {
  if (run.kind === "hyperlink") {
    return { ...run, runs: run.runs.map(cloneRun) };
  }
  return { ...run };
}

function cloneParagraph(para: DocxParagraph): DocxParagraph {
  return {
    ...para,
    properties: { ...para.properties },
    runs: para.runs.map(cloneRun),
  };
}

function cloneBlock(block: DocxBlock): DocxBlock {
  if (block.kind === "paragraph") return cloneParagraph(block);
  // table — shallow clone rows/cells (sufficient for immutability at block level)
  return {
    ...block,
    rows: block.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        paragraphs: cell.paragraphs.map(cloneParagraph),
      })),
    })),
  };
}

function cloneDoc(doc: DocxDocument): DocxDocument {
  return {
    ...doc,
    blocks: doc.blocks.map(cloneBlock),
    comments: [...doc.comments],
    styles: new Map(doc.styles),
    numbering: {
      abstractDefs: new Map(doc.numbering.abstractDefs),
      numDefs: new Map(doc.numbering.numDefs),
    },
    imageUrls: new Map(doc.imageUrls),
  };
}

// ─── Run traversal helpers ────────────────────────────────────────────────────

/** Collect all runs across all paragraphs in the doc (table cells included). */
function allParagraphs(doc: DocxDocument): DocxParagraph[] {
  const paras: DocxParagraph[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      paras.push(block);
    } else {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          paras.push(...cell.paragraphs);
        }
      }
    }
  }
  return paras;
}

function findParagraphContainingRun(
  doc: DocxDocument,
  runId: string
): { para: DocxParagraph; runIndex: number } | null {
  for (const para of allParagraphs(doc)) {
    const idx = para.runs.findIndex((r) => r.id === runId);
    if (idx !== -1) return { para, runIndex: idx };
  }
  return null;
}

/** Replace a paragraph (by id) in the document, returning a new doc. */
function replaceParagraphInDoc(
  doc: DocxDocument,
  paraId: string,
  updater: (p: DocxParagraph) => DocxParagraph
): DocxDocument {
  function updateBlocks(blocks: DocxBlock[]): DocxBlock[] {
    return blocks.map((block) => {
      if (block.kind === "paragraph") {
        return block.id === paraId ? updater(block) : block;
      }
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            paragraphs: cell.paragraphs.map((p) =>
              p.id === paraId ? updater(p) : p
            ),
          })),
        })),
      };
    });
  }
  return { ...doc, blocks: updateBlocks(doc.blocks) };
}

// ─── insertText ───────────────────────────────────────────────────────────────

/**
 * Insert text at the current selection position as a w:ins tracked change.
 *
 * If the selection is null or collapsed the new run is appended to the last
 * paragraph (safe fallback for programmatic use / tests).
 */
export function insertText(
  state: EditorState,
  author: string,
  text: string
): EditorState {
  const mark: TrackChangeMark = {
    id: newChangeId(),
    type: TrackChangeType.INSERTION,
    status: TrackChangeStatus.PENDING,
    author,
    date: new Date().toISOString(),
  };

  const newRun: DocxTextRun = {
    kind: "text",
    id: newRunId(),
    text,
    properties: {},
    trackChange: mark,
  };

  const doc = state.doc;
  let targetParaId: string | null = null;
  let insertAtIndex = -1; // -1 means append

  if (state.selection) {
    const location = findParagraphContainingRun(doc, state.selection.anchorRunId);
    if (location) {
      targetParaId = location.para.id;
      insertAtIndex = location.runIndex + 1;
    }
  }

  // Fallback: use the last paragraph
  if (!targetParaId) {
    const paras = allParagraphs(doc);
    if (paras.length > 0) {
      targetParaId = paras[paras.length - 1].id;
    }
  }

  let newDoc: DocxDocument;

  if (targetParaId) {
    newDoc = replaceParagraphInDoc(doc, targetParaId, (para) => {
      const runs = [...para.runs];
      if (insertAtIndex === -1 || insertAtIndex >= runs.length) {
        runs.push(newRun);
      } else {
        runs.splice(insertAtIndex, 0, newRun);
      }
      return { ...para, runs };
    });
  } else {
    // No paragraphs at all — create one
    const newPara: DocxParagraph = {
      kind: "paragraph",
      id: `para-cmd-${Date.now()}`,
      properties: {},
      runs: [newRun],
    };
    newDoc = { ...doc, blocks: [...doc.blocks, newPara] };
  }

  return applyDocChange(state, newDoc);
}

// ─── deleteRange ──────────────────────────────────────────────────────────────

/**
 * Mark the selected run range as a w:del tracked change.
 *
 * If there is no range selection this is a no-op.
 */
export function deleteRange(state: EditorState, author: string): EditorState {
  if (!state.selection || isCollapsed(state.selection)) return state;

  const { anchorRunId, focusRunId } = state.selection;
  const mark: TrackChangeMark = {
    id: newChangeId(),
    type: TrackChangeType.DELETION,
    status: TrackChangeStatus.PENDING,
    author,
    date: new Date().toISOString(),
  };

  // Apply the deletion mark to every run between anchor and focus
  // (same-paragraph simplified implementation)
  const doc = cloneDoc(state.doc);
  for (const para of allParagraphs(doc)) {
    let inRange = false;
    for (let i = 0; i < para.runs.length; i++) {
      const run = para.runs[i];
      if (run.id === anchorRunId) inRange = true;
      if (inRange && !run.trackChange) {
        para.runs[i] = { ...run, trackChange: mark };
      }
      if (run.id === focusRunId) break;
    }
  }

  return applyDocChange(state, doc);
}

// ─── acceptChange / rejectChange ──────────────────────────────────────────────

function updateRunTrackChange(
  doc: DocxDocument,
  changeId: string,
  newStatus: TrackChangeStatus
): DocxDocument {
  const cloned = cloneDoc(doc);
  for (const para of allParagraphs(cloned)) {
    for (let i = 0; i < para.runs.length; i++) {
      const run = para.runs[i];
      if (run.trackChange?.id === changeId) {
        para.runs[i] = {
          ...run,
          trackChange: { ...run.trackChange, status: newStatus },
        };
      }
    }
  }
  return cloned;
}

/**
 * Accept a single tracked change by ID.
 *
 * - INSERTION accepted → run becomes a plain run (trackChange removed).
 * - DELETION accepted  → run is removed from the paragraph.
 * - REPLACEMENT accepted → insertion side kept, deletion side removed.
 */
export function acceptChange(
  state: EditorState,
  changeId: string
): EditorState {
  const cloned = cloneDoc(state.doc);

  for (const para of allParagraphs(cloned)) {
    para.runs = para.runs.reduce<DocxInlineNode[]>((acc, run) => {
      if (run.trackChange?.id !== changeId) {
        acc.push(run);
        return acc;
      }
      const { type } = run.trackChange;
      if (type === TrackChangeType.INSERTION) {
        // Keep as plain run
        acc.push({ ...run, trackChange: undefined });
      } else if (type === TrackChangeType.DELETION) {
        // Drop the run entirely
      } else if (type === TrackChangeType.REPLACEMENT) {
        // Treat as insertion side — keep plain
        acc.push({ ...run, trackChange: undefined });
      }
      return acc;
    }, []);
  }

  return applyDocChange(state, cloned);
}

/**
 * Reject a single tracked change by ID.
 *
 * - INSERTION rejected → run is removed from the paragraph.
 * - DELETION rejected  → run becomes a plain run (trackChange removed).
 * - REPLACEMENT rejected → deletion side kept plain, insertion side removed.
 */
export function rejectChange(
  state: EditorState,
  changeId: string
): EditorState {
  const cloned = cloneDoc(state.doc);

  for (const para of allParagraphs(cloned)) {
    para.runs = para.runs.reduce<DocxInlineNode[]>((acc, run) => {
      if (run.trackChange?.id !== changeId) {
        acc.push(run);
        return acc;
      }
      const { type } = run.trackChange;
      if (type === TrackChangeType.INSERTION) {
        // Drop the run entirely
      } else if (type === TrackChangeType.DELETION) {
        // Keep as plain run
        acc.push({ ...run, trackChange: undefined });
      } else if (type === TrackChangeType.REPLACEMENT) {
        // Treat as deletion side — keep plain
        acc.push({ ...run, trackChange: undefined });
      }
      return acc;
    }, []);
  }

  return applyDocChange(state, cloned);
}

// ─── acceptAllChanges / rejectAllChanges ──────────────────────────────────────

/** Accept every pending tracked change in the document. */
export function acceptAllChanges(state: EditorState): EditorState {
  const cloned = cloneDoc(state.doc);

  for (const para of allParagraphs(cloned)) {
    para.runs = para.runs.reduce<DocxInlineNode[]>((acc, run) => {
      const tc = run.trackChange;
      if (!tc || tc.status !== TrackChangeStatus.PENDING) {
        acc.push(run);
        return acc;
      }
      if (
        tc.type === TrackChangeType.INSERTION ||
        tc.type === TrackChangeType.REPLACEMENT
      ) {
        acc.push({ ...run, trackChange: undefined });
      }
      // DELETION → drop
      return acc;
    }, []);
  }

  return applyDocChange(state, cloned);
}

/** Reject every pending tracked change in the document. */
export function rejectAllChanges(state: EditorState): EditorState {
  const cloned = cloneDoc(state.doc);

  for (const para of allParagraphs(cloned)) {
    para.runs = para.runs.reduce<DocxInlineNode[]>((acc, run) => {
      const tc = run.trackChange;
      if (!tc || tc.status !== TrackChangeStatus.PENDING) {
        acc.push(run);
        return acc;
      }
      if (
        tc.type === TrackChangeType.DELETION ||
        tc.type === TrackChangeType.REPLACEMENT
      ) {
        acc.push({ ...run, trackChange: undefined });
      }
      // INSERTION → drop
      return acc;
    }, []);
  }

  return applyDocChange(state, cloned);
}

// ─── setCharacterProperty ─────────────────────────────────────────────────────

/**
 * Apply a character (run) property to all runs in the current selection.
 * If there is no selection, this is a no-op.
 */
export function setCharacterProperty(
  state: EditorState,
  prop: keyof RunProperties,
  value: RunProperties[keyof RunProperties]
): EditorState {
  if (!state.selection) return state;

  const { anchorRunId, focusRunId } = state.selection;
  const cloned = cloneDoc(state.doc);

  for (const para of allParagraphs(cloned)) {
    let inRange = false;
    for (let i = 0; i < para.runs.length; i++) {
      const run = para.runs[i];
      if (run.id === anchorRunId) inRange = true;
      if (inRange) {
        para.runs[i] = {
          ...run,
          properties: { ...run.properties, [prop]: value },
        } as DocxInlineNode;
      }
      if (run.id === focusRunId) { inRange = false; break; }
    }
  }

  return applyDocChange(state, cloned);
}

// ─── setParagraphProperty ─────────────────────────────────────────────────────

/**
 * Apply a paragraph property to the paragraph(s) containing the selection.
 * If there is no selection, this is a no-op.
 */
export function setParagraphProperty(
  state: EditorState,
  prop: keyof ParagraphProperties,
  value: ParagraphProperties[keyof ParagraphProperties]
): EditorState {
  if (!state.selection) return state;

  const { anchorRunId, focusRunId } = state.selection;
  const anchorLoc = findParagraphContainingRun(state.doc, anchorRunId);
  const focusLoc = findParagraphContainingRun(state.doc, focusRunId);
  if (!anchorLoc) return state;

  const affectedIds = new Set<string>([anchorLoc.para.id]);
  if (focusLoc) affectedIds.add(focusLoc.para.id);

  const cloned = cloneDoc(state.doc);
  for (const para of allParagraphs(cloned)) {
    if (affectedIds.has(para.id)) {
      para.properties = { ...para.properties, [prop]: value };
    }
  }

  return applyDocChange(state, cloned);
}

// ─── undo / redo ──────────────────────────────────────────────────────────────

/** Undo the last document change. No-op when history is empty. */
export function undo(state: EditorState): EditorState {
  if (state.history.length === 0) return state;
  const previous = state.history[state.history.length - 1];
  return {
    ...state,
    doc: previous,
    history: state.history.slice(0, -1),
    future: [state.doc, ...state.future],
  };
}

/** Redo the last undone change. No-op when future stack is empty. */
export function redo(state: EditorState): EditorState {
  if (state.future.length === 0) return state;
  const next = state.future[0];
  return {
    ...state,
    doc: next,
    history: [...state.history, state.doc],
    future: state.future.slice(1),
  };
}

// ─── Internal re-export used by tests ────────────────────────────────────────
export { updateRunTrackChange };
