"use client";

/**
 * useMultiDocEditor — manages an array of EditorState instances + activeIndex.
 *
 * Supports opening files via:
 *  - File object (drag-and-drop / file picker)
 *  - Graph node ID (resolved via GET /api/workspaces/[slug]/documents/node)
 */

import { useState, useCallback } from "react";
import { EditorState, createEditorState } from "./editor-state";
import { EditorAction } from "./use-docx-editor";
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
import { parseDocx } from "@/lib/docx-engine";

// ─── Error toast surface ──────────────────────────────────────────────────────

// We avoid importing sonner here to keep this module pure; the caller supplies
// an onError callback instead.

export interface MultiDocEditorOptions {
  /** Workspace slug — used to build the node-resolution API URL. */
  slug?: string;
  /** Called when a document fails to open (e.g. 401/403 on fileUrl fetch). */
  onError?: (message: string) => void;
}

// ─── Reducer helper ───────────────────────────────────────────────────────────

function applyAction(state: EditorState, action: EditorAction): EditorState {
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

export interface MultiDocEditorHandle {
  /** All open document editor states. */
  docs: EditorState[];
  /** Index of the currently active tab. */
  activeIndex: number;
  /** Open a document from a File object. */
  openDocumentFromFile: (file: File) => Promise<void>;
  /** Open a document by resolving a graph node ID. */
  openDocumentFromNodeId: (nodeId: string) => Promise<void>;
  /** Open a document by fetching it via a presigned URL derived from an S3 key. */
  openDocumentFromS3Key: (s3Key: string, filename?: string) => Promise<void>;
  /** Close the document at the given index. */
  closeDocument: (index: number) => void;
  /** Switch the active tab to the given index. */
  setActiveTab: (index: number) => void;
  /** Dispatch an action to the document at the given index. */
  dispatch: (index: number, action: EditorAction) => void;
}

export function useMultiDocEditor(
  options: MultiDocEditorOptions = {}
): MultiDocEditorHandle {
  const { slug, onError } = options;
  const [docs, setDocs] = useState<EditorState[]>([]);
  const [activeIndex, setActiveIndexState] = useState(0);

  const reportError = useCallback(
    (message: string) => {
      if (onError) onError(message);
      else console.error("[useMultiDocEditor]", message);
    },
    [onError]
  );

  // ── openDocumentFromFile ──────────────────────────────────────────────────

  const openDocumentFromFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        const doc = await parseDocx(file);
        const state = createEditorState(doc);
        setDocs((prev) => {
          const next = [...prev, state];
          setActiveIndexState(next.length - 1);
          return next;
        });
      } catch (err) {
        reportError(
          `Failed to open "${file.name}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [reportError]
  );

  // ── openDocumentFromNodeId ────────────────────────────────────────────────

  const openDocumentFromNodeId = useCallback(
    async (nodeId: string): Promise<void> => {
      if (!slug) {
        reportError("Cannot resolve node ID without a workspace slug.");
        return;
      }

      let fileUrl: string;

      try {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(slug)}/documents/node?nodeId=${encodeURIComponent(nodeId)}`,
          { credentials: "include" }
        );

        if (res.status === 401 || res.status === 403) {
          reportError("You do not have permission to access this document.");
          return;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => String(res.status));
          reportError(`Failed to resolve node ${nodeId}: ${text}`);
          return;
        }

        const json = (await res.json()) as { fileUrl?: string };
        if (!json.fileUrl) {
          reportError(`Node ${nodeId} has no file URL.`);
          return;
        }
        fileUrl = json.fileUrl;
      } catch (err) {
        reportError(
          `Network error resolving node ${nodeId}: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      // Derive a filename from the URL path
      let filename = "document.docx";
      try {
        const url = new URL(fileUrl);
        const pathParts = url.pathname.split("/");
        const last = pathParts[pathParts.length - 1];
        if (last && last.length > 0) filename = decodeURIComponent(last);
      } catch {
        // keep default filename
      }

      // Fetch the blob
      let blob: Blob;
      try {
        const blobRes = await fetch(fileUrl, { credentials: "include" });
        if (blobRes.status === 401 || blobRes.status === 403) {
          reportError("Access denied when fetching the document file.");
          return;
        }
        if (!blobRes.ok) {
          reportError(`Failed to fetch document file: ${blobRes.status}`);
          return;
        }
        blob = await blobRes.blob();
      } catch (err) {
        reportError(
          `Network error fetching document: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      const file = new File([blob], filename, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      await openDocumentFromFile(file);
    },
    [slug, reportError, openDocumentFromFile]
  );

  // ── openDocumentFromS3Key ─────────────────────────────────────────────────

  const openDocumentFromS3Key = useCallback(
    async (s3Key: string, filename?: string): Promise<void> => {
      const presignedUrl = `/api/upload/presigned-url?s3Key=${encodeURIComponent(s3Key)}`;
      let res: Response;
      try {
        res = await fetch(presignedUrl);
      } catch (err) {
        reportError(
          `Network error opening document: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      // Use !res.ok — the endpoint returns 404 for all auth-denied/IDOR cases,
      // not 401 or 403, so checking specific codes would silently miss auth failures.
      if (!res.ok) {
        reportError(`Failed to open document: ${res.status} ${res.statusText}`);
        return;
      }

      // fetch() automatically follows the 302 redirect to S3 — do NOT set
      // redirect: 'manual'; the resolved response body is the blob directly.
      const blob = await res.blob();

      // s3Key is a bare path (e.g. "uploads/ws/.../ts_rand_report.docx") —
      // new URL() would throw on it. Use split/pop for safe filename derivation.
      const derivedFilename = filename ?? s3Key.split("/").pop() ?? "document.docx";
      const file = new File([blob], derivedFilename, { type: blob.type });
      await openDocumentFromFile(file);
    },
    [reportError, openDocumentFromFile]
  );

  // ── closeDocument ─────────────────────────────────────────────────────────

  const closeDocument = useCallback((index: number) => {
    setDocs((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      setActiveIndexState((active) => {
        if (next.length === 0) return 0;
        if (active >= next.length) return next.length - 1;
        if (active > index) return active - 1;
        return active;
      });
      return next;
    });
  }, []);

  // ── setActiveTab ──────────────────────────────────────────────────────────

  const setActiveTab = useCallback((index: number) => {
    setActiveIndexState(index);
  }, []);

  // ── dispatch ──────────────────────────────────────────────────────────────

  const dispatch = useCallback((index: number, action: EditorAction) => {
    setDocs((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      next[index] = applyAction(next[index], action);
      return next;
    });
  }, []);

  return {
    docs,
    activeIndex,
    openDocumentFromFile,
    openDocumentFromNodeId,
    openDocumentFromS3Key,
    closeDocument,
    setActiveTab,
    dispatch,
  };
}
