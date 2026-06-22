"use client";

import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EvalRequirement } from "@/hooks/useEvalRequirements";

const CREATE_NEW_VALUE = "__create_new__";
export { CREATE_NEW_VALUE };

export const CREATE_NEW_REQ = "__create_new_req__";

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
  // Requirement picker (optional for backward compat)
  requirements?: EvalRequirement[];
  loadingRequirements?: boolean;
  requirementsError?: string | null;
  selectedRequirementId?: string | null;
  onSelectRequirement?: (id: string | null) => void;
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
  requirements = [],
  loadingRequirements = false,
  requirementsError = null,
  selectedRequirementId,
  onSelectRequirement,
}: CaptureEvalFormProps) {
  const [reqSearch, setReqSearch] = useState("");

  // When switching to CREATE_NEW_VALUE, clear requirement selection
  useEffect(() => {
    if (selectedEvalSetId === CREATE_NEW_VALUE || !selectedEvalSetId) {
      onSelectRequirement?.(null);
      setReqSearch("");
    }
  }, [selectedEvalSetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When an existing set has no requirements, auto-select CREATE_NEW_REQ
  useEffect(() => {
    if (
      selectedEvalSetId &&
      selectedEvalSetId !== CREATE_NEW_VALUE &&
      !loadingRequirements &&
      !requirementsError &&
      requirements.length === 0
    ) {
      onSelectRequirement?.(CREATE_NEW_REQ);
    }
  }, [requirements, loadingRequirements, requirementsError, selectedEvalSetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const showRequirementPicker =
    !!selectedEvalSetId && selectedEvalSetId !== CREATE_NEW_VALUE;

  const showRequirementTextInput =
    !showRequirementPicker ||
    selectedRequirementId === CREATE_NEW_REQ ||
    selectedRequirementId == null;

  const filteredRequirements = reqSearch
    ? requirements.filter((r) =>
        r.properties.name.toLowerCase().includes(reqSearch.toLowerCase())
      )
    : requirements;

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
          <div className="max-h-40 overflow-y-auto rounded-md border p-2">
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
          </div>
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

      {/* Requirement picker — shown when an existing set is selected */}
      {showRequirementPicker && (
        <div className="space-y-1.5">
          <Label>
            Requirement <span className="text-destructive">*</span>
          </Label>
          {loadingRequirements ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading requirements…
            </div>
          ) : requirementsError ? (
            <p className="text-sm text-destructive">{requirementsError}</p>
          ) : requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requirements yet — create the first one below
            </p>
          ) : (
            <div className="space-y-1">
              {requirements.length > 4 && (
                <Input
                  placeholder="Search requirements…"
                  value={reqSearch}
                  onChange={(e) => setReqSearch(e.target.value)}
                  disabled={submitting}
                  aria-label="Search requirements"
                />
              )}
              <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                <div className="space-y-1">
                  {filteredRequirements.map((req) => {
                    const selected = selectedRequirementId === req.ref_id;
                    return (
                      <button
                        key={req.ref_id}
                        type="button"
                        disabled={submitting}
                        onClick={() => onSelectRequirement?.(req.ref_id)}
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
                        <span className="truncate">{req.properties.name}</span>
                      </button>
                    );
                  })}
                  {filteredRequirements.length === 0 && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      No requirements match your search
                    </p>
                  )}
                  {/* Create new requirement option */}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => onSelectRequirement?.(CREATE_NEW_REQ)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                      selectedRequirementId === CREATE_NEW_REQ
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    {selectedRequirementId === CREATE_NEW_REQ ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    Create new requirement
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Requirement text input — shown when creating new or no picker visible */}
      {showRequirementTextInput && (
        <div className="space-y-1">
          {!showRequirementPicker && (
            <Label htmlFor="eval-requirement">
              Requirement <span className="text-destructive">*</span>
            </Label>
          )}
          <Input
            id="eval-requirement"
            placeholder="What should this step always do?"
            value={requirement}
            onChange={(e) => onRequirementChange(e.target.value)}
            disabled={submitting}
          />
        </div>
      )}

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
