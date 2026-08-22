"use client";
import React from "react";

import { useState } from "react";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { EditorAction } from "@/lib/docx-editor/use-docx-editor";
import { Snapshot } from "@/lib/docx-editor/snapshot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Camera, RotateCcw, Clock } from "lucide-react";

interface DocxVersionPanelProps {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function DocxVersionPanel({ state, dispatch }: DocxVersionPanelProps) {
  const [savingLabel, setSavingLabel] = useState(false);
  const [label, setLabel] = useState("");

  const snapshots = [...state.snapshots].reverse(); // newest first

  const handleSave = () => {
    if (!label.trim()) return;
    dispatch({ type: "SAVE_SNAPSHOT", label: label.trim() });
    setLabel("");
    setSavingLabel(false);
  };

  const handleRevert = (id: string) => {
    dispatch({ type: "REVERT_TO_SNAPSHOT", snapshotId: id });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex-none flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Version History
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setSavingLabel((v) => !v)}
        >
          <Camera className="size-3.5 mr-1" />
          Save
        </Button>
      </div>

      {savingLabel && (
        <div className="p-3 border-b flex-none space-y-2 bg-muted/40">
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. v1 clean, v2 redline…"
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setSavingLabel(false);
            }}
          />
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSavingLabel(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!label.trim()}>
              Save Snapshot
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* "Now" entry */}
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-primary/10">
            <Clock className="size-3.5 text-primary shrink-0" />
            <span className="text-xs font-medium text-primary">Now (current)</span>
          </div>

          {snapshots.length > 0 && <Separator className="my-1" />}

          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{snap.label}</p>
                <p className="text-xs text-muted-foreground">{formatTime(snap.timestamp)}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRevert(snap.id)}
              >
                <RotateCcw className="size-3 mr-1" />
                Revert
              </Button>
            </div>
          ))}

          {snapshots.length === 0 && !savingLabel && (
            <p className="text-xs text-muted-foreground text-center py-6">No snapshots saved</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
