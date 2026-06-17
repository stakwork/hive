"use client";

import React, { useState, useEffect } from "react";
import { Bot, Zap, Globe, RefreshCw, GitBranch, X, CheckCircle2, Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkflowTransition, StepType, getStepType } from "@/types/stakwork/workflow";
import { isLlmStep, type TransitionStep } from "@/lib/stakwork/transitions";
import { FlagEvalStepModal } from "@/components/evals/FlagEvalStepModal";

interface StepDetailsModalProps {
  step: WorkflowTransition | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect?: () => void;
  runTransitions?: Record<string, WorkflowTransition>;
  /** Context needed to submit flag-for-eval from this modal */
  evalContext?: {
    slug: string;
    workflowId: string;
    runId: string;
  };
  projectId?: string;
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

export function StepDetailsModal({ step, isOpen, onClose, onSelect, runTransitions, evalContext, projectId }: StepDetailsModalProps) {
  const [isFlagModalOpen, setIsFlagModalOpen] = useState(false);
  const [ioData, setIoData] = useState<{ inputs: unknown; outputs: unknown } | null>(null);
  const [isLoadingIO, setIsLoadingIO] = useState(false);

  useEffect(() => {
    if (!isOpen || !projectId) {
      setIoData(null);
      return;
    }
    const runStep = runTransitions
      ? (runTransitions[step?.id ?? ''] ?? runTransitions[step?.name ?? ''] ?? null)
      : null;
    const effectiveStepId = runStep?.project_step_id ?? step?.name;
    if (!effectiveStepId) {
      setIoData(null);
      return;
    }
    let cancelled = false;
    setIsLoadingIO(true);
    fetch(`/api/projects/${projectId}/steps/${effectiveStepId}/io`)
      .then((r) => r.json())
      .then((result) => {
        if (!cancelled) {
          setIoData(result?.data ?? null);
        }
      })
      .catch(() => { if (!cancelled) setIoData(null); })
      .finally(() => { if (!cancelled) setIsLoadingIO(false); });
    return () => { cancelled = true; };
  }, [isOpen, projectId, step?.id, step?.name, step?.project_step_id, runTransitions]);

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

  // Derive run step from runTransitions
  const runStep = runTransitions
    ? (runTransitions[step.id] ?? runTransitions[step.name] ?? null)
    : undefined;

  // Determine if this is an LLM step.
  // Prefer the run transition (has runtime url) when available; fall back to the static step.
  const isLlm = runStep
    ? isLlmStep(runStep as unknown as TransitionStep)
    : isLlmStep(step as unknown as TransitionStep);
  const showFlagButton = isLlm && !!evalContext && !!runStep;

  // Check if we have any content to show
  const hasVars = Object.keys(stepVars).length > 0;
  const hasOtherAttributes = Object.keys(otherAttributes).length > 0;
  const hasAnyContent = hasVars || hasOtherAttributes;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-background rounded-lg shadow-lg border w-[75vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
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

        {/* Tabbed content */}
        <Tabs defaultValue="attributes" className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 pt-2 border-b shrink-0">
            <TabsList className="w-full">
              <TabsTrigger value="attributes">Attributes</TabsTrigger>
              <TabsTrigger value="inputs">Inputs</TabsTrigger>
              <TabsTrigger value="outputs">Outputs</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>
          </div>

          {/* Attributes — existing content verbatim */}
          <TabsContent value="attributes" className="flex-1 overflow-y-auto p-4 space-y-4 mt-0">
            {/* Step Name/Alias */}
            {stepId && (
              <Section title="Step Alias">
                <code className="text-sm bg-muted px-2 py-1 rounded">{stepId}</code>
              </Section>
            )}

            {/* Run Output section */}
            {runTransitions !== undefined && (
              <Section title="Run Output">
                {runStep ? (
                  <div className="space-y-2">
                    {runStep.status?.step_state && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Status:</span>
                        <Badge variant="outline">{runStep.status.step_state}</Badge>
                      </div>
                    )}
                    {runStep.has_output && runStep.output !== undefined && (
                      <Section title="Output">
                        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                          {typeof runStep.output === "string"
                            ? runStep.output
                            : JSON.stringify(runStep.output, null, 2)}
                        </pre>
                      </Section>
                    )}
                    {runStep.log && (
                      <Section title="Log">
                        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                          {runStep.log}
                        </pre>
                      </Section>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No run data for this step.</p>
                )}
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
          </TabsContent>

          {/* Inputs */}
          <TabsContent value="inputs" className="flex-1 overflow-y-auto p-4 mt-0">
            {!projectId ? (
              <p className="text-xs text-muted-foreground">Select a run to view IO data.</p>
            ) : isLoadingIO ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : ioData?.inputs != null ? (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[60vh] whitespace-pre-wrap">
                {JSON.stringify(ioData.inputs, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">No input data available.</p>
            )}
          </TabsContent>

          {/* Outputs */}
          <TabsContent value="outputs" className="flex-1 overflow-y-auto p-4 mt-0">
            {!projectId ? (
              <p className="text-xs text-muted-foreground">Select a run to view IO data.</p>
            ) : isLoadingIO ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : ioData?.outputs != null ? (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[60vh] whitespace-pre-wrap">
                {JSON.stringify(ioData.outputs, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">No output data available.</p>
            )}
          </TabsContent>

          {/* Logs — rendered as raw HTML */}
          <TabsContent value="logs" className="flex-1 overflow-y-auto p-4 mt-0">
            {runStep?.log ? (
              <div
                className="text-xs bg-muted p-3 rounded overflow-auto max-h-[60vh]"
                dangerouslySetInnerHTML={{ __html: runStep.log }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">No logs for this step.</p>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="flex justify-between gap-2 p-4 border-t">
          <div>
            {showFlagButton && (
              <Button variant="outline" size="sm" onClick={() => setIsFlagModalOpen(true)}>
                <Flag className="h-4 w-4 mr-2" />
                Flag for eval
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            {onSelect && (
              <Button onClick={onSelect}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Select Step
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Flag-for-eval modal — only mounted when we have the full context */}
      {showFlagButton && evalContext && (
        <FlagEvalStepModal
          open={isFlagModalOpen}
          onOpenChange={setIsFlagModalOpen}
          slug={evalContext.slug}
          workflowId={evalContext.workflowId}
          runId={evalContext.runId}
          stepId={step.id || step.name}
          runTransition={runStep as unknown as TransitionStep}
          onCaptured={() => setIsFlagModalOpen(false)}
        />
      )}
    </div>
  );
}
