"use client";

import React from "react";
import { Bot, Zap, Globe, RefreshCw, GitBranch, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectedStepContent, StepType } from "@/lib/workflow-step";

interface StepDetailsModalProps {
  step: SelectedStepContent | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: () => void;
}

const STEP_TYPE_ICONS: Record<StepType, React.ReactNode> = {
  automated: <Zap className="h-4 w-4" />,
  human: <Bot className="h-4 w-4" />,
  api: <Globe className="h-4 w-4" />,
  loop: <RefreshCw className="h-4 w-4" />,
  condition: <GitBranch className="h-4 w-4" />,
};

const STEP_TYPE_COLORS: Record<StepType, string> = {
  automated: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  human: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  api: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  loop: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  condition: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function JsonDisplay({ data }: { data: unknown }) {
  if (!data) return <span className="text-muted-foreground">None</span>;

  return (
    <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export function StepDetailsModal({ step, isOpen, onClose, onSelect }: StepDetailsModalProps) {
  if (!step || !isOpen) return null;

  const { stepData } = step;
  // The data structure from the workflow has attributes at the top level
  const rawData = stepData as unknown as Record<string, unknown>;
  const stepAttributes = (rawData.attributes as Record<string, unknown>) || stepData.step?.attributes || {};
  const stepVars = (stepAttributes.vars as Record<string, unknown>) || {};

  // Get step name and id from top level
  const skillName = (rawData.name as string) || step.name;
  const stepId = (rawData.id as string) || step.displayId;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background rounded-lg shadow-lg border w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <span className={`p-2 rounded-md ${STEP_TYPE_COLORS[step.stepType]}`}>
              {STEP_TYPE_ICONS[step.stepType]}
            </span>
            <div className="text-lg font-semibold">{skillName || step.displayName || step.name}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Step Name */}
          {stepId && (
            <Section title="Step Name">
              <code className="text-sm bg-muted px-2 py-1 rounded">{stepId}</code>
            </Section>
          )}

          {/* Variables - only show vars */}
          {Object.keys(stepVars).length > 0 && (
            <Section title="Variables">
              <JsonDisplay data={stepVars} />
            </Section>
          )}

          {/* Show message if no vars */}
          {Object.keys(stepVars).length === 0 && (
            <div className="text-muted-foreground text-sm">No variables configured for this step.</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={onSelect}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Select Step
          </Button>
        </div>
      </div>
    </div>
  );
}
