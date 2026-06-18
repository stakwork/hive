"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const CREATE_NEW_VALUE = "__create_new__";
export { CREATE_NEW_VALUE };

interface CaptureEvalFormProps {
  requirement: string;
  reason: string;
  onRequirementChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  submitting?: boolean;
  // Eval set selection
  evalSets: Array<{ ref_id: string; name: string }>;
  loadingEvalSets: boolean;
  evalSetsError: boolean;
  selectedEvalSetId: string;
  onSelectEvalSet: (id: string) => void;
  newEvalSetName: string;
  onNewEvalSetNameChange: (name: string) => void;
}

export function CaptureEvalForm({
  requirement,
  reason,
  onRequirementChange,
  onReasonChange,
  submitting,
  evalSets,
  loadingEvalSets,
  evalSetsError,
  selectedEvalSetId,
  onSelectEvalSet,
  newEvalSetName,
  onNewEvalSetNameChange,
}: CaptureEvalFormProps) {
  return (
    <div className="space-y-4">
      {/* Eval set picker */}
      <div className="space-y-1.5">
        <Label>
          Eval Set <span className="text-destructive">*</span>
        </Label>
        {loadingEvalSets ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading eval sets…
          </div>
        ) : evalSetsError ? (
          <p className="text-sm text-destructive">Failed to load eval sets</p>
        ) : (
          <ScrollArea className="max-h-40 rounded-md border p-2">
            <div className="space-y-1">
              {evalSets.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  No eval sets yet — create one below
                </p>
              )}
              {evalSets.map((es) => {
                const selected = selectedEvalSetId === es.ref_id;
                return (
                  <button
                    key={es.ref_id}
                    type="button"
                    disabled={submitting}
                    onClick={() => onSelectEvalSet(es.ref_id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                      selected ? "bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                  >
                    {selected ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {es.name}
                  </button>
                );
              })}
              {/* Create new option */}
              <button
                type="button"
                disabled={submitting}
                onClick={() => onSelectEvalSet(CREATE_NEW_VALUE)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                  selectedEvalSetId === CREATE_NEW_VALUE
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted",
                )}
              >
                {selectedEvalSetId === CREATE_NEW_VALUE ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <Plus className="h-3.5 w-3.5 shrink-0" />
                Create new eval set
              </button>
            </div>
          </ScrollArea>
        )}
        {selectedEvalSetId === CREATE_NEW_VALUE && (
          <Input
            placeholder="New eval set name"
            value={newEvalSetName}
            onChange={(e) => onNewEvalSetNameChange(e.target.value)}
            disabled={submitting}
            aria-label="New eval set name"
          />
        )}
      </div>

      {/* Requirement */}
      <div className="space-y-1">
        <Label htmlFor="eval-requirement">
          Requirement <span className="text-destructive">*</span>
        </Label>
        <Input
          id="eval-requirement"
          placeholder="What should this step always do?"
          value={requirement}
          onChange={(e) => onRequirementChange(e.target.value)}
          disabled={submitting}
        />
      </div>

      {/* Reason */}
      <div className="space-y-1">
        <Label htmlFor="eval-reason">Reason</Label>
        <Input
          id="eval-reason"
          placeholder="Why does this matter?"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          disabled={submitting}
        />
      </div>
    </div>
  );
}
