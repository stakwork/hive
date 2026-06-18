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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CaptureEvalForm } from "@/components/evals/CaptureEvalForm";

interface RequestStep {
  stepId: string;
  name: string;
  model: string | null;
  provider: string | null;
  endpoint_url: string | null;
  preview: string | null;
  method: string | null;
  messages: unknown[];
  body: {
    response_raw: string | null;
    output_text: string | null;
    finish_reason: string | null;
    prompt_change: string | null;
    model: string | null;
  };
}

interface FlagRunEvalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  workflowId: string;
  runId: string;
  onCaptured: () => void;
}

export function FlagRunEvalModal({
  open,
  onOpenChange,
  slug,
  workflowId,
  runId,
  onCaptured,
}: FlagRunEvalModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [steps, setSteps] = useState<RequestStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [stepsUnavailable, setStepsUnavailable] = useState(false);
  const [selectedStep, setSelectedStep] = useState<RequestStep | null>(null);

  // Step 2 state
  const [requirement, setRequirement] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch request steps when modal opens
  useEffect(() => {
    if (!open) return;
    setLoadingSteps(true);
    setStepsUnavailable(false);
    fetch(`/api/workspaces/${slug}/workflows/${workflowId}/runs/${runId}/request-steps`)
      .then((r) => r.json())
      .then((data) => {
        setSteps(data?.data?.steps ?? []);
        setStepsUnavailable(data?.data?.unavailable === true);
      })
      .catch(() => {
        toast.error("Failed to load request steps");
        setStepsUnavailable(true);
      })
      .finally(() => setLoadingSteps(false));
  }, [open, slug, workflowId, runId]);

  // Reset all state when modal closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setSteps([]);
      setLoadingSteps(false);
      setStepsUnavailable(false);
      setSelectedStep(null);
      setRequirement("");
      setReason("");
      setSubmitting(false);
    }
  }, [open]);

  function handleNext() {
    if (!selectedStep) return;
    setStep(2);
  }

  async function handleConfirm() {
    if (!selectedStep || !requirement.trim()) return;
    setSubmitting(true);
    try {
      const inputs = { model: selectedStep.model, messages: selectedStep.messages };
      const outputs = {
        response_raw: selectedStep.body.response_raw,
        output_text: selectedStep.body.output_text,
        finish_reason: selectedStep.body.finish_reason,
      };
      const res = await fetch(
        `/api/workspaces/${slug}/workflows/${workflowId}/eval/capture`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            run_id: runId,
            step_id: selectedStep.stepId,
            requirement: requirement.trim(),
            reason: reason.trim() || undefined,
            inputs,
            outputs,
          }),
        }
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
          <DialogTitle>
            Capture Eval — Step {step} of 2:{" "}
            {step === 1 ? "Select Request Step" : "Requirement Details"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            {loadingSteps ? (
              <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading steps…
              </div>
            ) : stepsUnavailable ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Could not load step data for this run. Please try again.
              </div>
            ) : steps.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No LLM request steps found in this run.
              </div>
            ) : (
              <ScrollArea className="max-h-64 rounded-md border p-2">
                <div className="space-y-1">
                  {steps.map((s) => {
                    const isSelected = selectedStep?.stepId === s.stepId;
                    return (
                      <button
                        key={s.stepId}
                        type="button"
                        onClick={() => setSelectedStep(s)}
                        className={cn(
                          "w-full flex items-start gap-2 rounded px-2 py-2 text-sm text-left transition-colors",
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted"
                        )}
                      >
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{s.name}</div>
                          <div className="flex gap-1.5 mt-0.5">
                            {s.model && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
                                {s.model}
                              </span>
                            )}
                            {s.provider && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
                                {s.provider}
                              </span>
                            )}
                          </div>
                          {s.preview && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {s.preview}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {step === 2 && (
          <CaptureEvalForm
            requirement={requirement}
            reason={reason}
            onRequirementChange={setRequirement}
            onReasonChange={setReason}
            submitting={submitting}
          />
        )}

        <DialogFooter className="gap-2">
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {steps.length > 0 && (
                <Button onClick={handleNext} disabled={!selectedStep}>
                  Next
                </Button>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={submitting}>
                Back
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={submitting || !requirement.trim()}
              >
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
