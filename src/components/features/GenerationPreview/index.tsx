import { Check, X, Sparkles, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GenerationSource } from "@/hooks/useAIGeneration";

interface GenerationPreviewProps {
  content: string;
  source: GenerationSource;
  onAccept: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function GenerationPreview({ content, source, onAccept, onReject, isLoading = false }: GenerationPreviewProps) {
  const Icon = source === "quick" ? Sparkles : Brain;
  const iconColor = source === "quick" ? "text-purple-500" : "text-purple-600";

  return (
    <div className="rounded-md border border-border bg-muted/50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 ${iconColor} flex-shrink-0 mt-1`} />
        <div className="flex-1 text-sm whitespace-pre-wrap">{content}</div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" onClick={onAccept} disabled={isLoading}>
          <Check className="h-4 w-4 mr-2 text-green-600" />
          Accept
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject} disabled={isLoading}>
          <X className="h-4 w-4 mr-2 text-red-600" />
          Reject
        </Button>
      </div>
    </div>
  );
}
