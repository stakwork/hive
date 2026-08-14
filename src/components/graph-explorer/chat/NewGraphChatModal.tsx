"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { GraphChatDispatchResponse } from "@/types/graph-chat";

/**
 * "New chat" modal for the Graph Agent Chat: prompt textarea plus the
 * per-thread "Allow concept change proposals" checkbox. The checkbox is
 * decided HERE, at chat creation, and is immutable for the life of the
 * thread (the server snapshots it onto every run and rejects flips).
 */
export function NewGraphChatModal({
  workspaceSlug,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sessionId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [proposalsEnabled, setProposalsEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/graph/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), proposalsEnabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { message?: string }).message || `Request failed (${res.status})`);
        return;
      }
      const { sessionId } = data as GraphChatDispatchResponse;
      setPrompt("");
      setProposalsEnabled(false);
      onOpenChange(false);
      onCreated(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="new-graph-chat-modal">
        <DialogHeader>
          <DialogTitle>New graph chat</DialogTitle>
          <DialogDescription>Ask the graph agent about this workspace&apos;s knowledge graph.</DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          rows={5}
          placeholder="What would you like to know about the graph?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="new-graph-chat-prompt"
        />

        <div className="flex items-start gap-2">
          <Checkbox
            id="graph-chat-proposals"
            checked={proposalsEnabled}
            onCheckedChange={(v) => setProposalsEnabled(v === true)}
            data-testid="new-graph-chat-proposals-checkbox"
          />
          <div className="grid gap-1 leading-none">
            <Label htmlFor="graph-chat-proposals" className="text-sm">
              Allow concept change proposals
            </Label>
            <p className="text-xs text-muted-foreground">
              The agent may propose edits, merges, or deletions of Concept nodes. Proposals are reviewed on the Learn
              page before anything changes.
            </p>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !prompt.trim()} data-testid="new-graph-chat-submit">
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Start chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
