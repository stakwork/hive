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

export function GenerationPreview({
  content,
  source,
  onAccept,
  onReject,
  isLoading = false,
}: GenerationPreviewProps) {
  const Icon = source === "quick" ? Sparkles : Brain;
  const iconColor = source === "quick" ? "text-purple-500" : "text-purple-600";

  return (
    <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="p-4 pb-20">
        <div className="flex items-start gap-3">
          <Icon className={`h-4 w-4 ${iconColor} flex-shrink-0 mt-1`} />
          <div className="flex-1 text-sm whitespace-pre-wrap">{content}</div>
        </div>
      </div>

      {/* Sticky Accept/Reject Buttons - stick to bottom of preview container */}
      <div className="sticky bottom-0 left-0 right-0 flex gap-2 justify-end p-4">
        <Button
          size="sm"
          variant="outline"
          onClick={onAccept}
          disabled={isLoading}
          className="shadow-md border-green-600/30 bg-background hover:bg-green-50 hover:border-green-600/50"
        >
          <Check className="h-4 w-4 mr-2 text-green-600" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReject}
          disabled={isLoading}
          className="shadow-md hover:bg-red-50"
        >
          <X className="h-4 w-4 mr-2 text-red-600" />
          Reject
        </Button>
      </div>
    </div>
  );
}