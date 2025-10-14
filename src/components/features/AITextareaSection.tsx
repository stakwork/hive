"use client";

import { useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AIButton } from "@/components/ui/ai-button";
import { SaveIndicator } from "./SaveIndicator";
import { cn } from "@/lib/utils";

interface GeneratedContent {
  content: string;
}

interface AITextareaSectionProps {
  id: string;
  label: string;
  description: string;
  type: "requirements" | "architecture";
  featureId: string;
  value: string | null;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onBlur: (value: string | null) => void;
  rows?: number;
  className?: string;
}

export function AITextareaSection({
  id,
  label,
  description,
  type,
  featureId,
  value,
  savedField,
  saving,
  saved,
  onChange,
  onBlur,
  rows = 8,
  className,
}: AITextareaSectionProps) {
  const [generatedContent, setGeneratedContent] = useState<string>("");

  const handleAccept = () => {
    if (generatedContent) {
      // Use the complete content from AI (no appending)
      onChange(generatedContent);
      onBlur(generatedContent);
      setGeneratedContent("");
    }
  };

  const handleReject = () => {
    setGeneratedContent("");
  };

  const handleGenerated = (results: GeneratedContent[]) => {
    if (results.length > 0) {
      setGeneratedContent(results[0].content);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <AIButton<GeneratedContent>
          endpoint={`/api/features/${featureId}/generate`}
          params={{ type }}
          onGenerated={handleGenerated}
          tooltip="Generate with AI"
          iconOnly
        />
        <SaveIndicator
          field={id}
          savedField={savedField}
          saving={saving}
          saved={saved}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {description}
      </p>

      {/* AI Suggestion Preview */}
      {generatedContent && (
        <div className="rounded-md border border-border bg-muted/50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0 mt-1" />
            <div className="flex-1 text-sm whitespace-pre-wrap">
              {generatedContent}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAccept}
            >
              <Check className="h-4 w-4 mr-2 text-green-600" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReject}
            >
              <X className="h-4 w-4 mr-2 text-red-600" />
              Reject
            </Button>
          </div>
        </div>
      )}

      <Textarea
        id={id}
        placeholder={`Type your ${label.toLowerCase()} here...`}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value || null)}
        rows={rows}
        className={cn("resize-y font-mono text-sm min-h-[200px]", className)}
      />
    </div>
  );
}
