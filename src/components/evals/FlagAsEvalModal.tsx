"use client";

import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { Loader2, Plus, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EvalSet {
  ref_id: string;
  name: string;
}

interface FlagAsEvalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  logId: string;
  logMeta: {
    agent: string;
    stakworkRunId: string | null;
    featureId: string | null;
    workflow_id: number | null;
  };
  onCaptureEntireSession?: () => void;
}

const CREATE_NEW_VALUE = "__create_new__";

export function FlagAsEvalModal({
  open,
  onOpenChange,
  slug,
  logId,
  logMeta,
  onCaptureEntireSession,
}: FlagAsEvalModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [evalSets, setEvalSets] = useState<EvalSet[]>([]);
  const [loadingEvalSets, setLoadingEvalSets] = useState(false);
  const [selectedEvalSetId, setSelectedEvalSetId] = useState<string>("");
  const [newEvalSetName, setNewEvalSetName] = useState("");
  const [reqName, setReqName] = useState("");
  const [reqDescription, setReqDescription] = useState("");
  const [positiveCases, setPositiveCases] = useState<string[]>([]);
  const [negativeCases, setNegativeCases] = useState<string[]>([]);
  const [step1Errors, setStep1Errors] = useState<Record<string, string>>({});
  const [creatingEvalSet, setCreatingEvalSet] = useState(false);
  const [resolvedEvalSetId, setResolvedEvalSetId] = useState<string | null>(null);

  // Step 2 state
  const [agent, setAgent] = useState("");
  const [environment, setEnvironment] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [endPoint, setEndPoint] = useState("");
  const [runCount, setRunCount] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  // Fetch eval sets when modal opens
  useEffect(() => {
    if (!open) return;
    setLoadingEvalSets(true);
    fetch(`/api/workspaces/${slug}/evals`)
      .then((r) => r.json())
      .then((data) => {
        setEvalSets(Array.isArray(data) ? data : (data.evalSets ?? []));
      })
      .catch(() => toast.error("Failed to load eval sets"))
      .finally(() => setLoadingEvalSets(false));
  }, [open, slug]);

  // Pre-fill Step 2 from logMeta when modal opens
  useEffect(() => {
    if (open) {
      setAgent(logMeta.agent ?? "");
      setEnvironment(logMeta.stakworkRunId ?? "");
    }
  }, [open, logMeta]);

  // Reset all state when modal closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setEvalSets([]);
      setSelectedEvalSetId("");
      setNewEvalSetName("");
      setReqName("");
      setReqDescription("");
      setPositiveCases([]);
      setNegativeCases([]);
      setStep1Errors({});
      setCreatingEvalSet(false);
      setResolvedEvalSetId(null);
      setAgent("");
      setEnvironment("");
      setStartPoint("");
      setEndPoint("");
      setRunCount(3);
      setSubmitting(false);
    }
  }, [open]);

  function validateStep1() {
    const errors: Record<string, string> = {};
    if (!selectedEvalSetId) errors.evalSet = "Please select or create an EvalSet";
    if (selectedEvalSetId === CREATE_NEW_VALUE && !newEvalSetName.trim())
      errors.newEvalSetName = "EvalSet name is required";
    if (!reqName.trim()) errors.reqName = "Requirement name is required";
    if (!reqDescription.trim()) errors.reqDescription = "Description is required";
    if (positiveCases.length === 0)
      errors.positiveCases = "At least one positive case is required";
    if (negativeCases.length === 0)
      errors.negativeCases = "At least one negative case is required";
    return errors;
  }

  async function handleNext() {
    const errors = validateStep1();
    if (Object.keys(errors).length > 0) {
      setStep1Errors(errors);
      return;
    }
    setStep1Errors({});

    if (selectedEvalSetId === CREATE_NEW_VALUE) {
      setCreatingEvalSet(true);
      try {
        const res = await fetch(`/api/workspaces/${slug}/evals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newEvalSetName.trim() }),
        });
        if (!res.ok) throw new Error("Failed to create eval set");
        const data = await res.json();
        const newId = data.ref_id ?? data.id;
        if (!newId) throw new Error("No ref_id returned");
        setResolvedEvalSetId(newId);
      } catch {
        toast.error("Failed to create eval set");
        return;
      } finally {
        setCreatingEvalSet(false);
      }
    } else {
      setResolvedEvalSetId(selectedEvalSetId);
    }

    setStep(2);
  }

  async function handleConfirm() {
    const evalSetId = resolvedEvalSetId ?? selectedEvalSetId;
    if (!evalSetId || evalSetId === CREATE_NEW_VALUE) {
      toast.error("No eval set selected");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/agent-logs/${logId}/flag-as-eval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evalSetId,
            requirementName: reqName.trim(),
            requirementDescription: reqDescription.trim(),
            positiveCases,
            negativeCases,
            agent: agent.trim(),
            environment: environment.trim(),
            startPoint: startPoint.trim() || undefined,
            endPoint: endPoint.trim() || undefined,
            runCount,
          }),
        }
      );
      if (!res.ok) throw new Error("Request failed");
      toast.success("Flagged as eval");
      onOpenChange(false);
    } catch {
      toast.error("Failed to flag as eval");
    } finally {
      setSubmitting(false);
    }
  }

  const allOptions = [
    ...evalSets,
    { ref_id: CREATE_NEW_VALUE, name: "" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Flag as Eval — Step {step} of 2:{" "}
            {step === 1 ? "EvalSet & Requirement" : "Trigger Details"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-5">
            {/* EvalSet picker */}
            <div className="space-y-2">
              <Label>EvalSet</Label>
              {loadingEvalSets ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading eval sets…
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-md border p-2">
                  <div className="space-y-1">
                    {evalSets.map((es) => {
                      const selected = selectedEvalSetId === es.ref_id;
                      return (
                        <button
                          key={es.ref_id}
                          type="button"
                          onClick={() => setSelectedEvalSetId(es.ref_id)}
                          className={cn(
                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-left transition-colors",
                            selected
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          )}
                        >
                          {selected ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          {es.name}
                        </button>
                      );
                    })}
                    {/* Create new option */}
                    <button
                      type="button"
                      onClick={() => setSelectedEvalSetId(CREATE_NEW_VALUE)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-left transition-colors",
                        selectedEvalSetId === CREATE_NEW_VALUE
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      )}
                    >
                      {selectedEvalSetId === CREATE_NEW_VALUE ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      Create new EvalSet
                    </button>
                  </div>
                </div>
              )}
              {selectedEvalSetId === CREATE_NEW_VALUE && (
                <div className="space-y-1">
                  <Input
                    placeholder="EvalSet name"
                    value={newEvalSetName}
                    onChange={(e) => setNewEvalSetName(e.target.value)}
                  />
                  {step1Errors.newEvalSetName && (
                    <p className="text-xs text-destructive">{step1Errors.newEvalSetName}</p>
                  )}
                </div>
              )}
              {step1Errors.evalSet && (
                <p className="text-xs text-destructive">{step1Errors.evalSet}</p>
              )}
            </div>

            {/* Requirement fields */}
            <div className="space-y-1">
              <Label htmlFor="req-name">Requirement Name *</Label>
              <Input
                id="req-name"
                placeholder="e.g. Auth error handling"
                value={reqName}
                onChange={(e) => setReqName(e.target.value)}
              />
              {step1Errors.reqName && (
                <p className="text-xs text-destructive">{step1Errors.reqName}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="req-description">It should… *</Label>
              <Textarea
                id="req-description"
                placeholder="e.g. it should correctly handle auth errors"
                value={reqDescription}
                onChange={(e) => setReqDescription(e.target.value)}
                rows={2}
              />
              {step1Errors.reqDescription && (
                <p className="text-xs text-destructive">{step1Errors.reqDescription}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Positive Cases *</Label>
              <TagInput
                items={positiveCases}
                onChange={setPositiveCases}
                placeholder="The agent correctly…"
              />
              {step1Errors.positiveCases && (
                <p className="text-xs text-destructive">{step1Errors.positiveCases}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Negative Cases *</Label>
              <TagInput
                items={negativeCases}
                onChange={setNegativeCases}
                placeholder="The agent fails to…"
              />
              {step1Errors.negativeCases && (
                <p className="text-xs text-destructive">{step1Errors.negativeCases}</p>
              )}
            </div>

            {onCaptureEntireSession && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { onOpenChange(false); onCaptureEntireSession(); }}
              >
                Or, quick-capture entire session →
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="trigger-agent">Agent *</Label>
              <Input
                id="trigger-agent"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="trigger-env">Environment *</Label>
              <Input
                id="trigger-env"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="trigger-start">Start Point</Label>
              <Input
                id="trigger-start"
                placeholder="Optional"
                value={startPoint}
                onChange={(e) => setStartPoint(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="trigger-end">End Point</Label>
              <Input
                id="trigger-end"
                placeholder="Optional"
                value={endPoint}
                onChange={(e) => setEndPoint(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="trigger-run-count">Run Count *</Label>
              <Input
                id="trigger-run-count"
                type="number"
                min={1}
                value={runCount}
                onChange={(e) => setRunCount(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 1 && (
            <Button onClick={handleNext} disabled={creatingEvalSet}>
              {creatingEvalSet && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Next
            </Button>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={submitting}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={submitting}>
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
