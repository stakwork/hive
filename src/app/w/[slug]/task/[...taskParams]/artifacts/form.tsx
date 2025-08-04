"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Artifact, FormContent, Option } from "@/lib/chat";

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
  const buttonOptions = content.options.filter(
    (option) => option.actionType === "button",
  );

  const handleSubmit = (action: Option) => {
    if (isDisabled) return;
    onAction(messageId, action, content.webhook);
  };

  return (
    <Card className="p-4 bg-card border rounded-lg">
      <p className="text-sm font-medium mb-3">{content.actionText}</p>

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
  );
}
