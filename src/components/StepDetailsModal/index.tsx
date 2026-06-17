"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bot, Zap, Globe, RefreshCw, GitBranch, X, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkflowTransition, StepType, getStepType } from "@/types/stakwork/workflow";

interface StepDetailsModalProps {
  step: WorkflowTransition | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect?: () => void;
  runTransitions?: Record<string, WorkflowTransition>;
  projectId?: string;
}

const STEP_TYPE_ICONS: Record<StepType, React.ReactNode> = {
  automated: <Zap className="h-4 w-4" />,
  human: <Bot className="h-4 w-4" />,
  api: <Globe className="h-4 w-4" />,
  loop: <RefreshCw className="h-4 w-4" />,
  condition: <GitBranch className="h-4 w-4" />,
};

const STEP_TYPE_TINT: Record<StepType, string> = {
  automated: "text-violet-600 dark:text-violet-400",
  human: "text-pink-600 dark:text-pink-400",
  api: "text-teal-600 dark:text-teal-400",
  loop: "text-purple-600 dark:text-purple-400",
  condition: "text-amber-600 dark:text-amber-500",
};

function StatusPill({ state }: { state: string }) {
  const s = state.toLowerCase();
  let cls = "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-zinc-500/20";
  if (["finished", "completed", "success"].includes(s))
    cls = "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20";
  else if (["error", "failed", "failure"].includes(s))
    cls = "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20";
  else if (["in_progress", "running", "active"].includes(s))
    cls = "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20";
  else if (["halted", "paused"].includes(s))
    cls = "bg-amber-500/10 text-amber-600 dark:text-amber-500 ring-amber-500/20";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${cls}`}
    >
      {state.replace(/_/g, " ")}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h4>
      <div className="text-sm">{children}</div>
    </div>
  );
}

const hideScrollbarStyle: React.CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

function KeyValueTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined);

  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>;
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
      <div className="grid grid-cols-[minmax(80px,180px)_1fr] border-b bg-muted/60 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <div>Name</div>
        <div>Value</div>
      </div>
      <div className="divide-y">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[minmax(80px,180px)_1fr] text-sm">
            <div
              className="hide-scrollbar max-h-20 overflow-x-auto border-r bg-muted/30 px-3 py-2 font-mono text-xs"
              style={hideScrollbarStyle}
            >
              <span className="whitespace-pre">{key}</span>
            </div>
            <div
              className="hide-scrollbar max-h-40 overflow-x-auto px-3 py-2"
              style={hideScrollbarStyle}
            >
              {typeof value === "object" ? (
                <pre className="font-mono text-xs whitespace-pre">{JSON.stringify(value, null, 2)}</pre>
              ) : (
                <span className="font-mono text-xs whitespace-pre">{String(value)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StepDetailsModal({ step, isOpen, onClose, onSelect, runTransitions, projectId }: StepDetailsModalProps) {
  const [ioData, setIoData] = useState<{ inputs: unknown; outputs: unknown } | null>(null);
  const [isLoadingIO, setIsLoadingIO] = useState(false);
  // Tracks whether a pointer press originated on the backdrop so a drag/click
  // that ends on the backdrop but began inside the modal doesn't close it.
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    if (!isOpen || !projectId) {
      setIoData(null);
      return;
    }
    // The IO endpoint is keyed by step name, not the internal step id.
    const stepName = step?.name;
    if (!stepName) {
      setIoData(null);
      return;
    }
    let cancelled = false;
    setIsLoadingIO(true);
    fetch(`/api/projects/${projectId}/steps/${stepName}/io`)
      .then((r) => r.json())
      .then((result) => {
        if (!cancelled) {
          setIoData(result?.data ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setIoData(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingIO(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, step?.name]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!step || !isOpen) return null;

  const stepType = getStepType(step);
  const rawData = step as unknown as Record<string, unknown>;
  const stepAttributes = (rawData.attributes as Record<string, unknown>) || step.step?.attributes || {};
  const stepVars = (stepAttributes.vars as Record<string, unknown>) || {};

  const otherAttributes = Object.fromEntries(
    Object.entries(stepAttributes).filter(([key]) => key !== "vars"),
  );

  const stepId = step.id || step.display_id;

  const runStep = runTransitions
    ? (runTransitions[step.id] ?? runTransitions[step.name] ?? null)
    : undefined;
  const runState = runStep?.status?.step_state;

  const hasVars = Object.keys(stepVars).length > 0;
  const hasOtherAttributes = Object.keys(otherAttributes).length > 0;
  const hasAnyContent = hasVars || hasOtherAttributes;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Step details: ${step.display_name || step.name}`}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
              <span className={STEP_TYPE_TINT[stepType]}>{STEP_TYPE_ICONS[stepType]}</span>
            </span>
            <div className="min-w-0">
              <div className="truncate text-base font-semibold tracking-tight">
                {step.display_name || step.name}
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground">{step.name}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {runState && <StatusPill state={runState} />}
            <button
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabbed content */}
        <Tabs defaultValue="attributes" className="flex flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b px-5 pt-3">
            <TabsList>
              <TabsTrigger value="attributes">Attributes</TabsTrigger>
              <TabsTrigger value="inputs">Inputs</TabsTrigger>
              <TabsTrigger value="outputs">Outputs</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="attributes" className="mt-0 flex-1 space-y-5 overflow-y-auto p-5">
            {stepId && (
              <Section title="Step Alias">
                <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{stepId}</code>
              </Section>
            )}

            {runTransitions !== undefined && (
              <Section title="Run Output">
                {runStep ? (
                  <div className="space-y-3">
                    {runStep.has_output && runStep.output !== undefined && (
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-mono text-xs">
                        {typeof runStep.output === "string"
                          ? runStep.output
                          : JSON.stringify(runStep.output, null, 2)}
                      </pre>
                    )}
                    {runStep.log && (
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-mono text-xs">
                        {runStep.log}
                      </pre>
                    )}
                    {!runStep.has_output && !runStep.log && (
                      <p className="text-sm text-muted-foreground">No output recorded for this run.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No run data for this step.</p>
                )}
              </Section>
            )}

            {hasVars && (
              <Section title="Variables">
                <KeyValueTable data={stepVars} />
              </Section>
            )}

            {hasOtherAttributes && (
              <Section title="Attributes">
                <KeyValueTable data={otherAttributes} />
              </Section>
            )}

            {!hasAnyContent && (
              <div className="text-sm text-muted-foreground">No attributes configured for this step.</div>
            )}
          </TabsContent>

          <TabsContent value="inputs" className="mt-0 flex-1 overflow-y-auto p-5">
            {!projectId ? (
              <p className="text-sm text-muted-foreground">Select a run to view IO data.</p>
            ) : isLoadingIO ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : ioData?.inputs != null ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-mono text-xs">
                {JSON.stringify(ioData.inputs, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">No input data available.</p>
            )}
          </TabsContent>

          <TabsContent value="outputs" className="mt-0 flex-1 overflow-y-auto p-5">
            {!projectId ? (
              <p className="text-sm text-muted-foreground">Select a run to view IO data.</p>
            ) : isLoadingIO ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : ioData?.outputs != null ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 font-mono text-xs">
                {JSON.stringify(ioData.outputs, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">No output data available.</p>
            )}
          </TabsContent>

          <TabsContent value="logs" className="mt-0 flex-1 overflow-y-auto p-5">
            {runStep?.log ? (
              <div
                className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs"
                dangerouslySetInnerHTML={{ __html: runStep.log }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No logs for this step.</p>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer */}
        {onSelect && (
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSelect}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Select Step
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
