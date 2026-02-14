import React, { useState } from "react";
import { Check, X, Sparkles, Brain, ArrowUp, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { TextHighlighter, type Highlight } from "@/components/features/TextHighlighter";
import type { GenerationSource } from "@/hooks/useAIGeneration";

interface GenerationPreviewProps {
  content: string;
  source: GenerationSource;
  onAccept: () => void;
  onReject: () => void;
  onProvideFeedback?: (feedback: string) => void;
  isLoading?: boolean;
}

/**
 * Escapes special XML characters in text content
 */
function escapeXML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Formats highlights and general feedback into XML structure
 */
function formatFeedbackXML(highlights: Highlight[], generalFeedback: string): string {
  let xml = "";
  
  // Add highlight-comment pairs
  highlights.forEach((highlight) => {
    xml += `<highlight>${escapeXML(highlight.text)}</highlight>`;
    xml += `<comment>${escapeXML(highlight.comment)}</comment>`;
  });
  
  // Add general feedback if present
  if (generalFeedback.trim()) {
    xml += `<general_feedback>${escapeXML(generalFeedback.trim())}</general_feedback>`;
  }
  
  return xml;
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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const Icon = source === "quick" ? Sparkles : Brain;
  const iconColor = source === "quick" ? "text-purple-500" : "text-purple-600";

  const handleProvideFeedback = () => {
    if (onProvideFeedback && (feedback.trim() || highlights.length > 0)) {
      const xmlFeedback = formatFeedbackXML(highlights, feedback);
      onProvideFeedback(xmlFeedback);
      setFeedback("");
      setHighlights([]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleProvideFeedback();
    }
  };

  return (
    <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300 pb-[112px]">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${iconColor} flex-shrink-0 mt-1`} />
            {highlights.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                <MessageSquare className="h-3 w-3 mr-1" />
                {highlights.length} {highlights.length === 1 ? "comment" : "comments"}
              </Badge>
            )}
          </div>
          <div className="flex-1 text-sm">
            <TextHighlighter
              highlights={highlights}
              onHighlightsChange={setHighlights}
            >
              <MarkdownRenderer size="compact">{content}</MarkdownRenderer>
            </TextHighlighter>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 rounded-b-md">
        <div className="flex flex-col gap-4 p-4">
          {/* Row 1: Feedback Input + Submit Button */}
          {onProvideFeedback && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Provide feedback..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="default"
                onClick={handleProvideFeedback}
                disabled={isLoading || (!feedback.trim() && highlights.length === 0)}
              >
                <ArrowUp className="h-4 w-4 mr-2" />
                Submit Feedback
              </Button>
            </div>
          )}
          
          {/* Row 2: Accept/Reject Buttons */}
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={onAccept}
              disabled={isLoading}
              className="hover:bg-green-50 dark:hover:bg-green-950/20"
            >
              <Check className="h-4 w-4 mr-2 text-green-600 dark:text-green-500" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onReject}
              disabled={isLoading}
              className="hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <X className="h-4 w-4 mr-2 text-red-600 dark:text-red-500" />
              Reject
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GenerationPreview;
