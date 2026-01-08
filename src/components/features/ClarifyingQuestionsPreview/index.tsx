"use client";

import React, { useState, useMemo } from "react";
import { HelpCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ClarifyingQuestion, QuestionOption, QuestionArtifact } from "@/types/stakwork";
import { normalizeOptions } from "@/types/stakwork";
import { ColorSwatch, CustomColorPicker, QuestionArtifactRenderer } from "./artifacts";

interface ColorSwatchItem {
  label: string;
  value: string;
}

function isValidColorSwatchArtifact(artifact: QuestionArtifact | undefined): artifact is QuestionArtifact & { data: ColorSwatchItem[] } {
  if (!artifact || artifact.type !== "color_swatch") return false;
  if (!Array.isArray(artifact.data)) return false;
  return artifact.data.some(
    (item) => typeof item === "object" && item !== null && typeof (item as ColorSwatchItem).label === "string" && typeof (item as ColorSwatchItem).value === "string"
  );
}

function isValidMermaidArtifact(artifact: QuestionArtifact | undefined): boolean {
  if (!artifact || artifact.type !== "mermaid") return false;
  return typeof artifact.data === "string" && artifact.data.trim().length > 0;
}

function isValidComparisonTableArtifact(artifact: QuestionArtifact | undefined): boolean {
  if (!artifact || artifact.type !== "comparison_table") return false;
  if (typeof artifact.data !== "object" || artifact.data === null) return false;
  const data = artifact.data as Record<string, unknown>;
  if (!Array.isArray(data.columns) || data.columns.length === 0) return false;
  if (!Array.isArray(data.rows) || data.rows.length === 0) return false;
  const validColumns = (data.columns as unknown[]).some(
    (col) => typeof col === "object" && col !== null && "category" in col && "type" in col
  );
  const validRows = (data.rows as unknown[]).some(
    (row) => typeof row === "object" && row !== null && "label" in row && "cells" in row
  );
  return validColumns && validRows;
}

function isValidArtifact(artifact: QuestionArtifact | undefined): boolean {
  if (!artifact) return false;
  switch (artifact.type) {
    case "mermaid":
      return isValidMermaidArtifact(artifact);
    case "comparison_table":
      return isValidComparisonTableArtifact(artifact);
    case "color_swatch":
      return isValidColorSwatchArtifact(artifact);
    default:
      return false;
  }
}

function shouldSkipQuestion(question: ClarifyingQuestion): boolean {
  if (!question.questionArtifact) return false;
  const { type } = question.questionArtifact;
  if (type === "mermaid" || type === "comparison_table") {
    return !isValidArtifact(question.questionArtifact);
  }
  return false;
}

function getColorFromArtifact(artifact: QuestionArtifact | undefined, optionLabel: string): string | undefined {
  if (!isValidColorSwatchArtifact(artifact)) return undefined;
  const item = (artifact.data as ColorSwatchItem[]).find(
    (i) => i.label.toLowerCase() === optionLabel.toLowerCase()
  );
  return item?.value;
}

interface ClarifyingQuestionsPreviewProps {
  questions: ClarifyingQuestion[];
  onSubmit: (answers: string) => void;
  isLoading?: boolean;
}

interface Answer {
  selections: string[];
  text: string;
  customColor?: string;
}

const emptyAnswer: Answer = { selections: [], text: "", customColor: "" };

function getDisplayAnswer(
  question: ClarifyingQuestion,
  answer: Answer,
  normalizedOptions?: QuestionOption[]
): string {
  if (answer.customColor) {
    const parts = [`Custom color: ${answer.customColor}`];
    if (answer.text.trim()) parts.push(answer.text.trim());
    return parts.join(" | ");
  }

  if (question.type === "text") {
    return answer.text.trim() || "Not answered";
  }

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
  const validQuestions = useMemo(
    () => questions.filter((q) => !shouldSkipQuestion(q)),
    [questions]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [showReview, setShowReview] = useState(false);

  const totalSteps = validQuestions.length;
  const currentStep = currentIndex + 1;
  const currentQuestion = validQuestions[currentIndex];
  const isLastQuestion = currentIndex === validQuestions.length - 1;
  const isFirstQuestion = currentIndex === 0;
  const currentAnswer = answers[currentIndex] || emptyAnswer;

  const normalizedOptions = useMemo(
    () => normalizeOptions(currentQuestion?.options),
    [currentQuestion?.options]
  );

  const isColorSwatchQuestion = isValidColorSwatchArtifact(currentQuestion?.questionArtifact);

  const hasValidDiagramArtifact = currentQuestion?.questionArtifact &&
    isValidArtifact(currentQuestion.questionArtifact) &&
    currentQuestion.questionArtifact.type !== "color_swatch";

  const updateAnswer = (update: Partial<Answer>) => {
    setAnswers((prev) => ({
      ...prev,
      [currentIndex]: { ...currentAnswer, ...update },
    }));
  };

  const handleOptionSelect = (optionValue: string) => {
    if (currentQuestion.type === "single_choice") {
      const isSelected = currentAnswer.selections.includes(optionValue);
      updateAnswer({
        selections: isSelected ? [] : [optionValue],
        customColor: "",
      });
    } else {
      const isSelected = currentAnswer.selections.includes(optionValue);
      const newSelections = isSelected
        ? currentAnswer.selections.filter((o) => o !== optionValue)
        : [...currentAnswer.selections, optionValue];
      updateAnswer({
        selections: newSelections,
        customColor: "",
      });
    }
  };

  const handleCustomColorChange = (color: string) => {
    updateAnswer({
      selections: [],
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
      onSubmit(formatAnswersForFeedback(validQuestions, answers));
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

  const getSelectedColor = (
    question: ClarifyingQuestion,
    answer: Answer
  ): string | undefined => {
    if (answer.customColor) return answer.customColor;
    if (isValidColorSwatchArtifact(question.questionArtifact)) {
      const opts = normalizeOptions(question.options);
      const selectedOpt = opts?.find((opt) => answer.selections.includes(opt.value));
      if (selectedOpt) {
        return getColorFromArtifact(question.questionArtifact, selectedOpt.label);
      }
    }
    return undefined;
  };

  return (
    <div className="relative rounded-md border border-border bg-muted/50 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="p-4 pb-[80px]">
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
          <div className="space-y-4 min-h-[280px]">
            {validQuestions.map((question, index) => {
              const answer = answers[index] || emptyAnswer;
              const opts = normalizeOptions(question.options);
              const selectedColor = getSelectedColor(question, answer);

              return (
                <div key={index} className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {index + 1}) {question.question}
                  </p>
                  <div className="flex items-center gap-2 pl-4">
                    {isValidColorSwatchArtifact(question.questionArtifact) && selectedColor && (
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
        ) : hasValidDiagramArtifact ? (
          <div className="flex gap-4 min-h-[280px]">
            <div className="w-[30%] flex flex-col">
              <h3 className="text-base font-semibold leading-relaxed text-foreground mb-3">
                {currentQuestion.question}
              </h3>

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

            <div className="w-[70%]">
              <QuestionArtifactRenderer
                artifact={currentQuestion.questionArtifact!}
                className="h-full"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col min-h-[280px]">
            <h3 className="text-base font-semibold leading-relaxed text-foreground mb-3">
              {currentQuestion.question}
            </h3>

            {isColorSwatchQuestion && normalizedOptions && (
              <div className="space-y-3 mb-3">
                <div className="flex flex-wrap gap-3">
                  {normalizedOptions.map((option) => {
                    const isSelected =
                      currentAnswer.selections.includes(option.value) &&
                      !currentAnswer.customColor;
                    const color = getColorFromArtifact(currentQuestion.questionArtifact, option.label);
                    if (!color) return null;

                    return (
                      <ColorSwatch
                        key={option.id}
                        color={color}
                        label={option.label}
                        selected={isSelected}
                        onClick={() => handleOptionSelect(option.value)}
                      />
                    );
                  })}
                </div>

                <CustomColorPicker
                  value={currentAnswer.customColor || ""}
                  onChange={handleCustomColorChange}
                  selected={!!currentAnswer.customColor}
                />
              </div>
            )}

            {!isColorSwatchQuestion &&
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
