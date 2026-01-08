"use client";

import React, { useState, useMemo } from "react";
import { HelpCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ClarifyingQuestion, QuestionOption } from "@/types/stakwork";
import { normalizeOptions } from "@/types/stakwork";
import { ArtifactRenderer, CustomColorPicker, QuestionArtifactRenderer } from "./artifacts";

interface ClarifyingQuestionsPreviewProps {
  questions: ClarifyingQuestion[];
  onSubmit: (answers: string) => void;
  isLoading?: boolean;
}

// Unified answer structure for all question types
interface Answer {
  selections: string[]; // For choice questions (stores option values)
  text: string; // For text questions or custom text on choice questions
  customColor?: string; // For custom color picker
}

const emptyAnswer: Answer = { selections: [], text: "", customColor: "" };

function getDisplayAnswer(
  question: ClarifyingQuestion,
  answer: Answer,
  normalizedOptions?: QuestionOption[]
): string {
  // Handle custom color
  if (answer.customColor) {
    const parts = [`Custom color: ${answer.customColor}`];
    if (answer.text.trim()) parts.push(answer.text.trim());
    return parts.join(" | ");
  }

  if (question.type === "text") {
    return answer.text.trim() || "Not answered";
  }

  // Map selection values back to labels for display
  const selectedLabels =
    normalizedOptions
      ?.filter((opt) => answer.selections.includes(opt.value))
      .map((opt) => opt.label) || answer.selections;

  const parts = [...selectedLabels];
  if (answer.text.trim()) {
    parts.push(answer.text.trim());
  }
  return parts.length > 0 ? parts.join(", ") : "Not answered";
}

function formatAnswersForFeedback(
  questions: ClarifyingQuestion[],
  answers: Record<number, Answer>
): string {
  return questions
    .map((q, i) => {
      const normalizedOptions = normalizeOptions(q.options);
      const answer = getDisplayAnswer(q, answers[i] || emptyAnswer, normalizedOptions);
      return `Q: ${q.question}\nA: ${answer}`;
    })
    .join("\n\n");
}

export function ClarifyingQuestionsPreview({
  questions,
  onSubmit,
  isLoading = false,
}: ClarifyingQuestionsPreviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [showReview, setShowReview] = useState(false);

  const totalSteps = questions.length;
  const currentStep = currentIndex + 1;
  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;
  const isFirstQuestion = currentIndex === 0;
  const currentAnswer = answers[currentIndex] || emptyAnswer;

  // Normalize options for current question
  const normalizedOptions = useMemo(
    () => normalizeOptions(currentQuestion?.options),
    [currentQuestion?.options]
  );

  // Check if options have color swatches
  const hasColorSwatches = useMemo(
    () => normalizedOptions?.some((opt) => opt.artifact?.type === "color_swatch") ?? false,
    [normalizedOptions]
  );

  const updateAnswer = (update: Partial<Answer>) => {
    setAnswers((prev) => ({
      ...prev,
      [currentIndex]: { ...currentAnswer, ...update },
    }));
  };

  const handleOptionSelect = (optionValue: string) => {
    if (currentQuestion.type === "single_choice") {
      // single_choice - toggle selection (allow deselection)
      const isSelected = currentAnswer.selections.includes(optionValue);
      updateAnswer({
        selections: isSelected ? [] : [optionValue],
        customColor: "", // Clear custom color when predefined selected
      });
    } else {
      // multiple_choice - toggle selection
      const isSelected = currentAnswer.selections.includes(optionValue);
      const newSelections = isSelected
        ? currentAnswer.selections.filter((o) => o !== optionValue)
        : [...currentAnswer.selections, optionValue];
      updateAnswer({
        selections: newSelections,
        customColor: "", // Clear custom color when predefined selected
      });
    }
  };

  const handleCustomColorChange = (color: string) => {
    updateAnswer({
      selections: [], // Clear predefined selections when custom selected
      customColor: color,
    });
  };

  const handlePrevious = () => {
    if (showReview) {
      setShowReview(false);
    } else if (!isFirstQuestion) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const hasCurrentAnswer =
    currentQuestion?.type === "text"
      ? currentAnswer.text.trim().length > 0
      : currentAnswer.selections.length > 0 ||
        currentAnswer.text.trim().length > 0 ||
        (currentAnswer.customColor?.length ?? 0) > 0;

  const handleNext = () => {
    if (showReview) {
      onSubmit(formatAnswersForFeedback(questions, answers));
    } else if (isLastQuestion) {
      setShowReview(true);
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && hasCurrentAnswer && !isLoading) {
      e.preventDefault();
      handleNext();
    }
  };

  // Helper to get selected color for review screen
  const getSelectedColor = (
    question: ClarifyingQuestion,
    answer: Answer
  ): string | undefined => {
    if (answer.customColor) return answer.customColor;

    const opts = normalizeOptions(question.options);
    const selectedOpt = opts?.find((opt) => answer.selections.includes(opt.value));
    if (selectedOpt?.artifact?.type === "color_swatch") {
      return selectedOpt.artifact.data.color as string;
    }
    return undefined;
  };

  return (
    <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="p-4 pb-[80px]">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <HelpCircle className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {showReview ? "Review Your Answers" : "Question"}
              </p>
              {!showReview && (
                <span className="text-xs text-muted-foreground">
                  {currentStep} of {totalSteps}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-4">
          {Array.from({ length: totalSteps }).map((_, index) => (
            <div
              key={index}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index < currentStep - 1
                  ? "bg-primary"
                  : index === currentStep - 1
                    ? "bg-primary/60"
                    : "bg-border"
              )}
            />
          ))}
        </div>

        {showReview ? (
          /* Review Step */
          <div className="space-y-4 min-h-[280px]">
            {questions.map((question, index) => {
              const answer = answers[index] || emptyAnswer;
              const opts = normalizeOptions(question.options);
              const selectedColor = getSelectedColor(question, answer);
              const hasColorArtifacts = opts?.some(
                (opt) => opt.artifact?.type === "color_swatch"
              );

              return (
                <div key={index} className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {index + 1}) {question.question}
                  </p>
                  <div className="flex items-center gap-2 pl-4">
                    {/* Show color swatch if applicable */}
                    {hasColorArtifacts && selectedColor && (
                      <div
                        className="w-6 h-6 rounded border border-border flex-shrink-0"
                        style={{ backgroundColor: selectedColor }}
                      />
                    )}
                    <p className="text-sm text-foreground">
                      {getDisplayAnswer(question, answer, opts)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : currentQuestion.questionArtifact ? (
          /* Question Step - Side-by-side layout with diagram */
          <div className="flex gap-4 min-h-[280px]">
            {/* Left: Question content (30%) */}
            <div className="w-[30%] flex flex-col">
              <h3 className="text-base font-semibold leading-relaxed text-foreground mb-3">
                {currentQuestion.question}
              </h3>

              {/* Standard Options */}
              {normalizedOptions &&
                (currentQuestion.type === "single_choice" ||
                  currentQuestion.type === "multiple_choice") && (
                  <div className="space-y-2 mb-3">
                    {normalizedOptions.map((option) => {
                      const isSelected = currentAnswer.selections.includes(option.value);

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleOptionSelect(option.value)}
                          disabled={isLoading}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 rounded-md text-left transition-colors",
                            "border border-transparent",
                            isSelected
                              ? "bg-primary/10 border-primary/30"
                              : "hover:bg-muted/50",
                            isLoading && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div
                            className={cn(
                              "mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                              currentQuestion.type === "multiple_choice" && "rounded-sm",
                              isSelected
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/40"
                            )}
                          >
                            {isSelected && (
                              <Check className="h-3 w-3 text-primary-foreground" />
                            )}
                          </div>
                          <span className="text-sm leading-relaxed">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

              {/* Text input */}
              <Textarea
                placeholder="Add additional context or type a custom answer..."
                value={currentAnswer.text}
                onChange={(e) => updateAnswer({ text: e.target.value })}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Right: Diagram (70%) */}
            <div className="w-[70%]">
              <QuestionArtifactRenderer
                artifact={currentQuestion.questionArtifact}
                className="h-full"
              />
            </div>
          </div>
        ) : (
          /* Question Step - Standard layout (no diagram) */
          <div className="flex flex-col min-h-[280px]">
            <h3 className="text-base font-semibold leading-relaxed text-foreground mb-3">
              {currentQuestion.question}
            </h3>

            {/* Color Swatches Layout */}
            {hasColorSwatches && normalizedOptions && (
              <div className="space-y-3 mb-3">
                {/* Color swatches in a flex row */}
                <div className="flex flex-wrap gap-3">
                  {normalizedOptions.map((option) => {
                    const isSelected =
                      currentAnswer.selections.includes(option.value) &&
                      !currentAnswer.customColor;

                    return (
                      <ArtifactRenderer
                        key={option.id}
                        artifact={option.artifact!}
                        label={option.label}
                        selected={isSelected}
                        onClick={() => handleOptionSelect(option.value)}
                      />
                    );
                  })}
                </div>

                {/* Custom color picker (if enabled) */}
                {currentQuestion.allowCustomColor && (
                  <CustomColorPicker
                    value={currentAnswer.customColor || ""}
                    onChange={handleCustomColorChange}
                    selected={!!currentAnswer.customColor}
                  />
                )}
              </div>
            )}

            {/* Standard Options (no color swatches) */}
            {!hasColorSwatches &&
              normalizedOptions &&
              (currentQuestion.type === "single_choice" ||
                currentQuestion.type === "multiple_choice") && (
                <div className="space-y-2 mb-3">
                  {normalizedOptions.map((option) => {
                    const isSelected = currentAnswer.selections.includes(option.value);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => handleOptionSelect(option.value)}
                        disabled={isLoading}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md text-left transition-colors",
                          "border border-transparent",
                          isSelected
                            ? "bg-primary/10 border-primary/30"
                            : "hover:bg-muted/50",
                          isLoading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center",
                            currentQuestion.type === "multiple_choice" && "rounded-sm",
                            isSelected
                              ? "border-primary bg-primary"
                              : "border-muted-foreground/40"
                          )}
                        >
                          {isSelected && (
                            <Check className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                        <span className="text-sm leading-relaxed">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

            {/* Text input - always shown, fills remaining space for text questions */}
            <Textarea
              placeholder={
                currentQuestion.type === "text"
                  ? "Type your answer..."
                  : "Add additional context or type a custom answer..."
              }
              value={currentAnswer.text}
              onChange={(e) => updateAnswer({ text: e.target.value })}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              rows={currentQuestion.type === "text" ? undefined : 3}
              className={cn(
                "resize-none",
                currentQuestion.type === "text" && "flex-1 min-h-[200px]"
              )}
            />
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 rounded-b-md">
        <div className="flex items-center justify-center gap-3 p-3">
          {(!isFirstQuestion || showReview) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handlePrevious}
              disabled={isLoading}
            >
              Back
            </Button>
          )}

          <Button
            size="sm"
            variant="default"
            onClick={handleNext}
            disabled={isLoading || (!showReview && !hasCurrentAnswer)}
          >
            {showReview ? (
              <>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Submit
              </>
            ) : isLastQuestion ? (
              "Review"
            ) : (
              "Next"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ClarifyingQuestionsPreview;
