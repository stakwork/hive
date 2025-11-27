import { useState } from "react";
import { Check, X, Sparkles, Brain, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GenerationSource } from "@/hooks/useAIGeneration";

interface GenerationPreviewProps {
  content: string;
  source: GenerationSource;
  onAccept: () => void;
  onReject: () => void;
  onProvideFeedback?: (feedback: string) => void;
  isLoading?: boolean;
}

export function GenerationPreview({
  content,
  source,
  onAccept,
  onReject,
  onProvideFeedback,
  isLoading = false,
}: GenerationPreviewProps) {
  const [feedback, setFeedback] = useState("");
  const Icon = source === "quick" ? Sparkles : Brain;
  const iconColor = source === "quick" ? "text-purple-500" : "text-purple-600";

  const handleProvideFeedback = () => {
    if (feedback.trim() && onProvideFeedback) {
      onProvideFeedback(feedback.trim());
      setFeedback("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleProvideFeedback();
    }
  };

  return (
    <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300 pb-[72px]">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <Icon className={`h-4 w-4 ${iconColor} flex-shrink-0 mt-1`} />
          <div className="flex-1 text-sm whitespace-pre-wrap">{content}</div>
        </div>
      </div>

      {/* Buttons - absolute at component bottom, sticky to viewport when scrolling */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 rounded-b-md">
        {/* Buttons row */}
        <div className={`relative flex items-center gap-3 p-4 ${!onProvideFeedback ? 'justify-end' : ''}`}>
          {/* Feedback Input - inline with buttons */}
          {onProvideFeedback && (
            <>
              <div className="flex-1 relative">
                <Input
                  type="text"
                  placeholder="Provide feedback..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isLoading}
                  className="pr-10 shadow-sm bg-background/95"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleProvideFeedback}
                  disabled={isLoading || !feedback.trim()}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 rounded-full"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>

              {/* Vertical divider */}
              <div className="h-8 w-px bg-border" />
            </>
          )}

          {/* Accept/Reject buttons */}
          <div className="flex gap-2 shrink-0">
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
      </div>
    </div>
  );
}