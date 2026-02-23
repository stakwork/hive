import React, { useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GenerationFeedbackBarProps {
  onSubmit: (feedback: string) => void;
  isLoading?: boolean;
}

export function GenerationFeedbackBar({
  onSubmit,
  isLoading = false,
}: GenerationFeedbackBarProps) {
  const [feedback, setFeedback] = useState("");

  const handleSubmit = () => {
    if (feedback.trim()) {
      onSubmit(feedback.trim());
      setFeedback("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-center gap-2 mt-2">
      <Input
        placeholder="Provide feedback to iterate..."
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        className="flex-1"
      />
      <Button
        size="sm"
        variant="default"
        onClick={handleSubmit}
        disabled={isLoading || !feedback.trim()}
      >
        <ArrowUp className="h-4 w-4 mr-2" />
        Send
      </Button>
    </div>
  );
}
