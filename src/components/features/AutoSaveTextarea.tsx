"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SaveIndicator } from "./SaveIndicator";
import { cn } from "@/lib/utils";

interface AutoSaveTextareaProps {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  value: string | null;
  rows?: number;
  className?: string;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onBlur: (value: string | null) => void;
  onFocus: () => void;
}

export function AutoSaveTextarea({
  id,
  label,
  description,
  placeholder,
  value,
  rows = 4,
  className,
  savedField,
  saving,
  saved,
  onChange,
  onBlur,
  onFocus,
}: AutoSaveTextareaProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <SaveIndicator
          field={id}
          savedField={savedField}
          saving={saving}
          saved={saved}
        />
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Textarea
        id={id}
        placeholder={placeholder || `Type your ${label.toLowerCase()} here...`}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value || null)}
        onFocus={onFocus}
        rows={rows}
        className={cn("resize-y", className)}
      />
    </div>
  );
}
