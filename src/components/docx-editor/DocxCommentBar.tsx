"use client";
import React from "react";

import { useState } from "react";
import { EditorAction } from "@/lib/docx-editor/use-docx-editor";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { DocxComment } from "@/lib/docx-engine/types/document";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MessageSquarePlus, Trash2, CheckCircle } from "lucide-react";

function authorInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface DocxCommentBarProps {
  state: EditorState;
  activeCommentId?: string;
  currentAuthor: string;
  onCommentActivate: (id: string | undefined) => void;
  dispatch: (action: EditorAction) => void;
}

export default function DocxCommentBar({
  state,
  activeCommentId,
  currentAuthor,
  onCommentActivate,
  dispatch,
}: DocxCommentBarProps) {
  const [addingComment, setAddingComment] = useState(false);
  const [newBody, setNewBody] = useState("");

  const comments = state.doc.comments;

  const handleAdd = () => {
    if (!newBody.trim()) return;
    // We add comment anchored to current selection's anchor run if available
    const anchorRunId = state.selection?.anchorRunId ?? "unknown";
    dispatch({ type: "ADD_COMMENT", author: currentAuthor, anchorRunId, body: newBody.trim() });
    setNewBody("");
    setAddingComment(false);
  };

  const handleDelete = (id: string) => {
    dispatch({ type: "DELETE_COMMENT", commentId: id });
    if (activeCommentId === id) onCommentActivate(undefined);
  };

  const handleResolve = (id: string) => {
    dispatch({ type: "RESOLVE_COMMENT", commentId: id });
    if (activeCommentId === id) onCommentActivate(undefined);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex-none flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Comments ({comments.length})
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setAddingComment((v) => !v)}
        >
          <MessageSquarePlus className="size-3.5 mr-1" />
          Add
        </Button>
      </div>

      {addingComment && (
        <div className="p-3 border-b flex-none space-y-2 bg-muted/40">
          <textarea
            autoFocus
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Write a comment…"
            className="w-full text-sm border rounded p-2 resize-none bg-background min-h-[72px] focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
              if (e.key === "Escape") setAddingComment(false);
            }}
          />
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingComment(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={!newBody.trim()}>
              Comment
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {comments.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No comments</p>
          )}
          {comments.map((comment) => (
            <div
              key={comment.id}
              onClick={() => onCommentActivate(comment.id)}
              className={`rounded-md border p-2 space-y-1.5 cursor-pointer transition-colors ${
                activeCommentId === comment.id
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
                  : "bg-card hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center size-6 rounded-full bg-amber-400 text-white text-xs font-semibold shrink-0">
                  {authorInitial(comment.author)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{comment.author}</p>
                  <p className="text-xs text-muted-foreground">{relativeTime(comment.date)}</p>
                </div>
              </div>
              {comment.anchorText && (
                <p className="text-xs text-muted-foreground italic bg-muted rounded px-1.5 py-0.5 line-clamp-1">
                  "{comment.anchorText}"
                </p>
              )}
              <p className="text-xs">{comment.body}</p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); handleResolve(comment.id); }}
                >
                  <CheckCircle className="size-3 mr-1" />
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); handleDelete(comment.id); }}
                >
                  <Trash2 className="size-3 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
