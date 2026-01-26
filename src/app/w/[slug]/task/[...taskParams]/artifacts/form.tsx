"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, FormContent, Option } from "@/lib/chat";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

// Artifact Components
export function FormArtifact({
  messageId,
  artifact,
  onAction,
  selectedOption,
  isDisabled,
}: {
  messageId: string;
  artifact: Artifact;
  onAction: (messageId: string, action: Option, webhook: string) => void;
  selectedOption?: Option | null;
  isDisabled?: boolean;
}) {
  const content = artifact.content as FormContent;

  // Only show buttons for actionType="button" options
  const buttonOptions = content.options?.filter(
    (option) => option.actionType === "button",
  ) || [];

  const handleSubmit = (action: Option) => {
    if (isDisabled) return;
    onAction(messageId, action, content.webhook);
  };

  return (
    <div className="relative">
      <Card className={`p-4 bg-card rounded-lg relative ${!isDisabled ? "border border-primary/30" : "border"}`}>
        <div className="text-sm font-medium mb-3">
          <MarkdownRenderer>{content.actionText}</MarkdownRenderer>
        </div>

        {/* Only show buttons for actionType="button" options */}
        {buttonOptions.length > 0 && (
          <div className="space-y-2">
            {buttonOptions.map((option, index) => {
              const isSelected =
                selectedOption &&
                option.optionResponse === selectedOption.optionResponse;

              return (
                <Button
                  key={index}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSubmit(option)}
                  className={`w-full justify-start ${
                    isSelected ? "bg-primary text-primary-foreground" : ""
                  }`}
                  disabled={isDisabled}
                >
                  {option.optionLabel}
                </Button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
