"use client";

import React from "react";
import { Bot, Zap, Globe, RefreshCw, GitBranch, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowTransition, StepType, getStepType } from "@/types/stakwork/workflow";

interface StepDetailsModalProps {
  step: WorkflowTransition | null;
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

const hideScrollbarStyle: React.CSSProperties = {
  scrollbarWidth: 'none', // Firefox
  msOverflowStyle: 'none', // IE/Edge
};

function KeyValueTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined);

  if (entries.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className="grid grid-cols-[minmax(80px,180px)_1fr] text-xs font-medium text-muted-foreground bg-muted px-3 py-2 border-b">
        <div>Name</div>
        <div>Value</div>
      </div>
      <div className="divide-y">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[minmax(80px,180px)_1fr] text-sm">
            <div
              className="px-3 py-2 font-medium bg-muted/30 border-r overflow-x-auto max-h-20 hide-scrollbar"
              style={hideScrollbarStyle}
            >
              <span className="whitespace-pre">{key}</span>
            </div>
            <div
              className="px-3 py-2 overflow-x-auto max-h-40 hide-scrollbar"
              style={hideScrollbarStyle}
            >
              {typeof value === 'object' ? (
                <pre className="text-xs whitespace-pre">{JSON.stringify(value, null, 2)}</pre>
              ) : (
                <span className="whitespace-pre">{String(value)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StepDetailsModal({ step, isOpen, onClose, onSelect }: StepDetailsModalProps) {
  if (!step || !isOpen) return null;

  const stepType = getStepType(step);
  // The data structure from the workflow has attributes at the top level
  const rawData = step as unknown as Record<string, unknown>;
  const stepAttributes = (rawData.attributes as Record<string, unknown>) || step.step?.attributes || {};
  const stepVars = (stepAttributes.vars as Record<string, unknown>) || {};

  // Get all other attributes excluding 'vars' for display
  const otherAttributes = Object.fromEntries(
    Object.entries(stepAttributes).filter(([key]) => key !== 'vars')
  );

  // Get step id from top level
  const stepId = step.id || step.display_id;

  // Check if we have any content to show
  const hasVars = Object.keys(stepVars).length > 0;
  const hasOtherAttributes = Object.keys(otherAttributes).length > 0;
  const hasAnyContent = hasVars || hasOtherAttributes;

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
            <span className={`p-2 rounded-md ${STEP_TYPE_COLORS[stepType]}`}>
              {STEP_TYPE_ICONS[stepType]}
            </span>
            <div>
              <div className="text-lg font-semibold">{step.display_name || step.name}</div>
              <div className="text-xs text-muted-foreground">{step.name}</div>
            </div>
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
          {/* Step Name/Alias */}
          {stepId && (
            <Section title="Step Alias">
              <code className="text-sm bg-muted px-2 py-1 rounded">{stepId}</code>
            </Section>
          )}

          {/* Variables (for SetVar and other steps with vars) */}
          {hasVars && (
            <Section title="Variables">
              <KeyValueTable data={stepVars} />
            </Section>
          )}

          {/* Other Attributes (prompt, statement, url, etc.) */}
          {hasOtherAttributes && (
            <Section title="Attributes">
              <KeyValueTable data={otherAttributes} />
            </Section>
          )}

          {/* Show message if no attributes */}
          {!hasAnyContent && (
            <div className="text-muted-foreground text-sm">No attributes configured for this step.</div>
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
