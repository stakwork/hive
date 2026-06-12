"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

export interface WorkflowSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: "loading" | "error" | "content";
  content?: string;
  errorMessage?: string;
  onRetry?: () => void;
}

export function WorkflowSummaryDialog({
  open,
  onOpenChange,
  state,
  content,
  errorMessage,
  onRetry,
}: WorkflowSummaryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[75vw]">
        <DialogHeader>
          <DialogTitle>Workflow Changes Summary</DialogTitle>
          <DialogDescription>
            AI-generated summary of changes across selected workflow versions.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto">
          {state === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating summary…</p>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <p className="text-sm text-destructive">
                {errorMessage ?? "An error occurred while generating the summary."}
              </p>
              {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          )}

          {state === "content" && content && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownRenderer>{content}</MarkdownRenderer>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
