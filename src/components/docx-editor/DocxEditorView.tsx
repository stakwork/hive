"use client";
import React from "react";

import { useCallback, useRef } from "react";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { EditorAction } from "@/lib/docx-editor/use-docx-editor";
import DocxPage from "./DocxPage";
import DocxTrackChangeBar from "./DocxTrackChangeBar";
import DocxCommentBar from "./DocxCommentBar";
import DocxVersionPanel from "./DocxVersionPanel";
import DocxClauseNav from "./DocxClauseNav";
import DocxFindReplace from "./DocxFindReplace";
import { RightPanelKind } from "./DocxToolbar";

interface DocxEditorViewProps {
  allStates: EditorState[];
  activeIndex: number;
  dispatch: (docIndex: number, action: EditorAction) => void;
  /** Called when replaceInDocs replaces entire state array (find/replace) */
  onReplaceAllStates: (newStates: EditorState[]) => void;
  currentAuthor: string;
  zoom: number;
  showLeftPanel: boolean;
  rightPanel: RightPanelKind;
  showFindReplace: boolean;
  onCloseFindReplace: () => void;
  showTrackChanges: boolean;
}

// Map DOM InputType → editor actions
const INPUT_TYPE_DELETE_MAP: Record<string, boolean> = {
  deleteContentBackward: true,
  deleteContentForward: true,
  deleteWordBackward: true,
  deleteWordForward: true,
  deleteHardLineBackward: true,
  deleteHardLineForward: true,
  deleteSoftLineBackward: true,
  deleteSoftLineForward: true,
  deleteEntireSoftLine: true,
  deleteByDrag: true,
  deleteByCut: true,
  deleteContent: true,
};

export default function DocxEditorView({
  allStates,
  activeIndex,
  dispatch,
  onReplaceAllStates,
  currentAuthor,
  zoom,
  showLeftPanel,
  rightPanel,
  showFindReplace,
  onCloseFindReplace,
  showTrackChanges,
}: DocxEditorViewProps) {
  const activeState = allStates[activeIndex] ?? null;
  const activeDoc = activeState?.doc ?? null;
  const activeCommentIdRef = useRef<string | undefined>(undefined);

  const d = useCallback(
    (action: EditorAction) => dispatch(activeIndex, action),
    [dispatch, activeIndex]
  );

  // Interception beforeinput — the browser must NEVER mutate our OOXML state
  const handleBeforeInput = useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      const ev = e as unknown as InputEvent;
      ev.preventDefault();

      const inputType = ev.inputType ?? "";

      if (inputType === "insertText" && ev.data) {
        d({ type: "INSERT_TEXT", author: currentAuthor, text: ev.data });
        return;
      }

      if (inputType === "insertFromPaste" && ev.data) {
        d({ type: "INSERT_TEXT", author: currentAuthor, text: ev.data });
        return;
      }

      if (inputType === "insertParagraph" || inputType === "insertLineBreak") {
        d({ type: "INSERT_TEXT", author: currentAuthor, text: "\n" });
        return;
      }

      if (INPUT_TYPE_DELETE_MAP[inputType]) {
        d({ type: "DELETE_RANGE", author: currentAuthor });
        return;
      }

      // Formatting shortcuts via beforeinput (some browsers)
      if (inputType === "formatBold") {
        d({ type: "SET_CHARACTER_PROPERTY", prop: "bold", value: true });
        return;
      }
      if (inputType === "formatItalic") {
        d({ type: "SET_CHARACTER_PROPERTY", prop: "italic", value: true });
        return;
      }
      if (inputType === "formatUnderline") {
        d({ type: "SET_CHARACTER_PROPERTY", prop: "underline", value: true });
        return;
      }
      // Undo/redo via beforeinput
      if (inputType === "historyUndo") {
        d({ type: "UNDO" });
        return;
      }
      if (inputType === "historyRedo") {
        d({ type: "REDO" });
        return;
      }
    },
    [d, currentAuthor]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        d({ type: "UNDO" });
        return;
      }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        d({ type: "REDO" });
        return;
      }
      if (mod && e.key === "b") {
        e.preventDefault();
        d({ type: "SET_CHARACTER_PROPERTY", prop: "bold", value: true });
        return;
      }
      if (mod && e.key === "i") {
        e.preventDefault();
        d({ type: "SET_CHARACTER_PROPERTY", prop: "italic", value: true });
        return;
      }
      if (mod && e.key === "u") {
        e.preventDefault();
        d({ type: "SET_CHARACTER_PROPERTY", prop: "underline", value: true });
        return;
      }
    },
    [d]
  );

  const handleCommentActivate = useCallback((id: string | undefined) => {
    activeCommentIdRef.current = id;
  }, []);

  const rightSidebar = (() => {
    if (!activeState || !rightPanel) return null;
    if (rightPanel === "changes") {
      return (
        <DocxTrackChangeBar
          allStates={allStates}
          activeIndex={activeIndex}
          dispatch={dispatch}
        />
      );
    }
    if (rightPanel === "comments") {
      return (
        <DocxCommentBar
          state={activeState}
          currentAuthor={currentAuthor}
          activeCommentId={activeCommentIdRef.current}
          onCommentActivate={handleCommentActivate}
          dispatch={d}
        />
      );
    }
    if (rightPanel === "versions") {
      return <DocxVersionPanel state={activeState} dispatch={d} />;
    }
    return null;
  })();

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Find & Replace sticky bar */}
      {showFindReplace && (
        <DocxFindReplace
          allStates={allStates}
          activeIndex={activeIndex}
          onReplace={onReplaceAllStates}
          onClose={onCloseFindReplace}
        />
      )}

      {/* Three-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar — clause nav */}
        {showLeftPanel && (
          <aside className="w-56 border-r flex-none flex flex-col overflow-hidden">
            {activeState && <DocxClauseNav state={activeState} />}
          </aside>
        )}

        {/* Canvas — contentEditable root */}
        <div
          className="flex-1 overflow-auto bg-gray-100 dark:bg-zinc-900"
          aria-label="Document canvas"
        >
          <div
            // contentEditable canvas root — browser owns caret + selection
            contentEditable={activeDoc !== null}
            suppressContentEditableWarning
            className="min-h-full py-8 outline-none"
            onBeforeInput={handleBeforeInput}
            onKeyDown={handleKeyDown}
            aria-multiline="true"
            aria-label="Document editor"
            role="textbox"
            spellCheck={false}
          >
            {activeDoc && (
              <DocxPage
                doc={activeDoc}
                currentAuthor={currentAuthor}
                onCommentActivate={handleCommentActivate}
                zoom={zoom}
                // Hide deleted runs visually when showTrackChanges is off
                // (still rendered but hidden via opacity — future enhancement)
              />
            )}
          </div>
        </div>

        {/* Right sidebar */}
        {rightSidebar && (
          <aside className="w-72 border-l flex-none flex flex-col overflow-hidden">
            {rightSidebar}
          </aside>
        )}
      </div>
    </div>
  );
}
