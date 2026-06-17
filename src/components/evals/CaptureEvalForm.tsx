"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CaptureEvalFormProps {
  requirement: string;
  reason: string;
  onRequirementChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  submitting?: boolean;
}

export function CaptureEvalForm({
  requirement,
  reason,
  onRequirementChange,
  onReasonChange,
  submitting,
}: CaptureEvalFormProps) {
  return (
    <div className="space-y-4">
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
