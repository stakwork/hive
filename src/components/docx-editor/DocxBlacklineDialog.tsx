"use client";
import React from "react";

import { useState, useRef } from "react";
import { generateBlackline } from "@/lib/docx-editor/blackline";
import { EditorState, createEditorState } from "@/lib/docx-editor/editor-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { parseDocx } from "@/lib/docx-engine";
import { Upload, FileText, Loader2 } from "lucide-react";

interface DocxBlacklineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: EditorState[];
  /** Called with the new blackline EditorState to open as a virtual tab */
  onBlacklineGenerated: (state: EditorState, label: string) => void;
}

type DocSource = { kind: "tab"; index: number } | { kind: "upload"; file: File };

export default function DocxBlacklineDialog({
  open,
  onOpenChange,
  states,
  onBlacklineGenerated,
}: DocxBlacklineDialogProps) {
  const [docAIndex, setDocAIndex] = useState<string>("");
  const [docBSource, setDocBSource] = useState<DocSource | null>(null);
  const [docBTabIndex, setDocBTabIndex] = useState<string>("");
  const [docBFile, setDocBFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setDocAIndex("");
    setDocBSource(null);
    setDocBTabIndex("");
    setDocBFile(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocBFile(file);
    setDocBSource({ kind: "upload", file });
    setDocBTabIndex("");
  };

  const handleGenerate = async () => {
    setError(null);

    const aIdx = parseInt(docAIndex, 10);
    if (isNaN(aIdx) || !states[aIdx]) {
      setError("Please select Document A.");
      return;
    }

    let bState: EditorState | null = null;

    if (docBSource?.kind === "tab") {
      bState = states[docBSource.index] ?? null;
    } else if (docBSource?.kind === "upload" && docBSource.file) {
      try {
        setLoading(true);
        const doc = await parseDocx(docBSource.file);
        bState = createEditorState(doc);
      } catch (err) {
        setError(`Failed to parse file: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
        return;
      }
    }

    if (!bState) {
      setError("Please select or upload Document B.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const blacklineDoc = generateBlackline(states[aIdx].doc, bState.doc);
      const newState = createEditorState(blacklineDoc);
      const label = `Blackline: ${states[aIdx].doc.filename} ↔ ${bState.doc.filename}`;
      onBlacklineGenerated(newState, label);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(`Blackline generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Generate Blackline
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Document A */}
          <div className="space-y-1.5">
            <Label htmlFor="doc-a" className="text-sm font-medium">
              Document A (base)
            </Label>
            <Select value={docAIndex} onValueChange={setDocAIndex}>
              <SelectTrigger id="doc-a" className="h-9">
                <SelectValue placeholder="Select base document…" />
              </SelectTrigger>
              <SelectContent>
                {states.map((s, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {s.doc.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Document B */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Document B (revised)</Label>

            {/* Tab selector */}
            <Select
              value={docBTabIndex}
              onValueChange={(v) => {
                setDocBTabIndex(v);
                setDocBSource({ kind: "tab", index: parseInt(v, 10) });
                setDocBFile(null);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select open document…" />
              </SelectTrigger>
              <SelectContent>
                {states.map((s, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {s.doc.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Or upload */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">or</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3 mr-1.5" />
                {docBFile ? docBFile.name : "Upload .docx"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={loading || !docAIndex}>
            {loading ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate Blackline"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
