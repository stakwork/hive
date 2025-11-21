"use client";

import { Check } from "lucide-react";

interface SaveIndicatorProps {
  field: string;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
}

export function SaveIndicator({
  field,
  savedField,
  saving,
  saved,
}: SaveIndicatorProps) {
  // Show saved indicator if this field was saved
  const isSavedField = savedField === field;

  // Only show when saved (not while saving)
  if (!isSavedField || !saved || saving) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Check className="h-3 w-3 text-green-600" />
      <span className="text-green-600">Saved</span>
    </span>
  );
}
