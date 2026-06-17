"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import { Loader2 } from "lucide-react";
import { extractStepFromTransition, type TransitionStep } from "@/lib/stakwork/transitions";

interface FlagEvalStepModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  workflowId: string;
  runId: string;
  stepId: string;
  /** The already-loaded run transition for this step — no extra fetch required */
  runTransition: TransitionStep;
  onCaptured: () => void;
}

export function FlagEvalStepModal({
  open,
  onOpenChange,
  slug,
  workflowId,
  runId,
  stepId,
  runTransition,
  onCaptured,
}: FlagEvalStepModalProps) {
  const [requirement, setRequirement] = useState("");
  const [reason, setReason] = useState("");
  const [positiveCases, setPositiveCases] = useState<string[]>([]);
  const [negativeCases, setNegativeCases] = useState<string[]>([]);
  const [checkType, setCheckType] = useState("non_empty");
  const [submitting, setSubmitting] = useState(false);

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setRequirement("");
      setReason("");
      setPositiveCases([]);
      setNegativeCases([]);
      setCheckType("non_empty");
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (!requirement.trim()) return;
    setSubmitting(true);

    // Build snapshot from already-loaded transition — no extra fetch
    const extracted = extractStepFromTransition(runTransition);

    try {
      const res = await fetch(
        `/api/workspaces/${slug}/workflows/${workflowId}/eval/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            run_id: runId,
            step_id: stepId,
            requirement: requirement.trim(),
            reason: reason.trim() || undefined,
            desirable_cases: positiveCases,
            undesirable_cases: negativeCases,
            check: { type: checkType, want: true },
            // Client-side snapshot — no extra fetch needed
            body: extracted.body,
          }),
        },
      );

      if (!res.ok) throw new Error("Request failed");
      toast.success("Eval captured");
      onCaptured();
      onOpenChange(false);
    } catch {
      toast.error("Failed to capture eval");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Flag for Eval</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="flag-requirement">Requirement *</Label>
            <Input
              id="flag-requirement"
              placeholder="What should this step always do?"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="flag-reason">Reason</Label>
            <Input
              id="flag-reason"
              placeholder="Why does this matter?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Positive cases</Label>
            <TagInput
              items={positiveCases}
              onChange={setPositiveCases}
              placeholder="Response should…"
            />
          </div>

          <div className="space-y-1">
            <Label>Negative cases</Label>
            <TagInput
              items={negativeCases}
              onChange={setNegativeCases}
              placeholder="Response should not…"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="flag-check-type">Check</Label>
            <Input
              id="flag-check-type"
              value={checkType}
              onChange={(e) => setCheckType(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !requirement.trim()}
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Capture Eval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
