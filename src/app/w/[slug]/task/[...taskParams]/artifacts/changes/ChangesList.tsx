"use client";

import React, { useMemo, useState } from "react";
import { FileCode, AlignLeft, Code2, ChevronDown, ChevronRight, Plus, Minus, Layers } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { DiffView, computeDiffStats } from "./DiffView";
import { useItemBaseline } from "@/hooks/useItemBaseline";
import { usePromptVersionChain } from "@/hooks/usePromptVersionChain";
import { useScriptVersionChain } from "@/hooks/useScriptVersionChain";
import type {
  ChangeBaselineSource,
  PromptBaselineSnapshot,
  ScriptBaselineSnapshot,
} from "@/lib/chat";

// ── Item types ────────────────────────────────────────────────────────────────

/** One captured workflow version within a task (oldest first once sorted). */
export type WorkflowIteration = {
  workflowVersionId: string;
  artifactId?: string;
  /** Canonicalised spec for this version, captured at ingestion. */
  value: string;
};

export type WorkflowChangedItem = {
  type: "WORKFLOW";
  name: string;
  /** Legacy single-diff sides — used when no version iterations were captured. */
  originalJson: string | object | null;
  updatedJson: string | object | null;
  /** Ordered captured versions, oldest first. Present = stacked-diff path. */
  iterations?: WorkflowIteration[];
  /** The version the task started from. null = no prior version to compare against. */
  baselineSnapshot?: { workflowVersionId: string; value: string } | null;
};

/** One captured iteration of a prompt change within a task. */
export type PromptIteration = {
  promptVersionId: string;
  artifactId?: string;
  /** Captured value for this version (from versionSnapshot). May be absent for legacy artifacts. */
  value?: string;
  /** Authoritative version number (from versionSnapshot). May be absent for legacy artifacts. */
  versionNumber?: number;
};

export type PromptChangedItem = {
  type: "PROMPT";
  name: string;
  promptId: string;
  /** Latest (or sole) version id — kept for legacy single-iteration / fallback path. */
  promptVersionId: string;
  /** Ordered list of all iterations (by versionNumber), oldest first. Absent = legacy single item. */
  iterations?: PromptIteration[];
  /** What the earliest iteration is measured against — the prompt's published version when the task's first change was made. null = brand-new prompt. */
  baselineSnapshot?: PromptBaselineSnapshot | null;
};

/** One captured iteration of a script change within a task. */
export type ScriptIteration = {
  scriptVersionId: number;
  artifactId?: string;
  /** Captured source for this version (from versionSnapshot). Absent for legacy artifacts. */
  value?: string;
  /** Authoritative version number (from versionSnapshot). Absent for legacy artifacts. */
  versionNumber?: number;
};

export type ScriptChangedItem = {
  type: "SCRIPT";
  name: string;
  scriptId: number;
  /** Latest (or sole) version id — kept for the legacy single-diff fallback. */
  scriptVersionId: number;
  /** Ordered list of all iterations (by versionNumber), oldest first. Absent = legacy single item. */
  iterations?: ScriptIteration[];
  /** What the earliest iteration is measured against. null = brand-new script. */
  baselineSnapshot?: ScriptBaselineSnapshot | null;
};

export type ChangedItem = WorkflowChangedItem | PromptChangedItem | ScriptChangedItem;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Add/del line counts for the collapsed section header.
 *
 * Delegates to DiffView's own counter so the badge always matches the numbers
 * shown once the section is expanded.
 */
export function countAddDel(
  original: string | object | null,
  updated: string | object | null,
): { additions: number; deletions: number } {
  if (!updated) return { additions: 0, deletions: 0 };
  return computeDiffStats(original, updated);
}

// ── Section icon + label ──────────────────────────────────────────────────────

function itemIcon(type: ChangedItem["type"]) {
  if (type === "WORKFLOW") return <FileCode className="w-4 h-4 text-muted-foreground" />;
  if (type === "PROMPT") return <AlignLeft className="w-4 h-4 text-muted-foreground" />;
  return <Code2 className="w-4 h-4 text-muted-foreground" />;
}

function itemLabel(type: ChangedItem["type"]) {
  if (type === "WORKFLOW") return "Workflow";
  if (type === "PROMPT") return "Prompt";
  return "Script";
}

// ── Add/del badge ─────────────────────────────────────────────────────────────

function AddDelBadge({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-mono">
      <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
        <Plus className="w-3 h-3" />
        {additions}
      </span>
      <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
        <Minus className="w-3 h-3" />
        {deletions}
      </span>
    </span>
  );
}

// ── StepDiff ──────────────────────────────────────────────────────────────────
// One "previous → this" diff, collapsible on its own so a long edit history
// reads as an index you can drill into. Shared by every item type — same
// interaction, different domain labels.

type ChangeKind = "workflow" | "prompt" | "script";

function StepDiff({
  kind,
  index,
  label,
  original,
  updated,
}: {
  kind: ChangeKind;
  index: number;
  label: string;
  original: string | object | null;
  updated: string | object | null;
}) {
  // Closed by default — the list reads as an index of what changed when, and you
  // expand the step you care about.
  const [open, setOpen] = useState(false);

  return (
    <div data-testid={`${kind}-step-${index}`}>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid={`${kind}-step-toggle-${index}`}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-xs font-mono text-muted-foreground">{label}</span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          <div className="h-60">
            <DiffView original={original} updated={updated} label={kind} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── WorkflowSectionBody ───────────────────────────────────────────────────────
// Two views over the same captured versions:
//   • overall  — task's starting version → latest version ("all changes done")
//   • steps    — previous version → this version, per landed version
// Falls back to the single originalJson/updatedJson diff for artifacts that
// predate version snapshots.

function WorkflowSectionBody({ item }: { item: WorkflowChangedItem }) {
  const [stepsOpen, setStepsOpen] = useState(false);

  const iterations = item.iterations;

  if (!iterations || iterations.length === 0) {
    return (
      <div className="h-80">
        <DiffView original={item.originalJson} updated={item.updatedJson} label="workflow" />
      </div>
    );
  }

  const latest = iterations[iterations.length - 1];
  // baselineSnapshot: undefined = never captured; null = no prior version (all-green)
  const baselineValue = item.baselineSnapshot?.value ?? null;
  const baselineLabel = item.baselineSnapshot
    ? `vs v${item.baselineSnapshot.workflowVersionId}`
    : undefined;

  return (
    <div className="flex flex-col">
      {/* Overall: starting version → latest version */}
      <div className="h-80">
        <DiffView
          original={baselineValue}
          updated={latest.value}
          label="workflow"
          baselineLabel={baselineLabel}
        />
      </div>

      {/* Per-version steps. Shown whenever versions landed, so a single change
          can still be inspected on its own terms. */}
      <div className="border-t border-border">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors text-left"
          onClick={() => setStepsOpen((o) => !o)}
          data-testid="workflow-steps-toggle"
        >
          {stepsOpen ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          <Layers className="w-3 h-3 flex-shrink-0" />
          <span>
            {iterations.length} version{iterations.length !== 1 ? "s" : ""}
            {` (up to v${latest.workflowVersionId})`}
          </span>
        </button>

        {stepsOpen && (
          <div className="divide-y divide-border/60">
            {iterations.map((iter, idx) => {
              const prev = idx === 0 ? item.baselineSnapshot ?? null : iterations[idx - 1];
              return (
                <StepDiff
                  key={iter.workflowVersionId}
                  kind="workflow"
                  index={idx}
                  label={
                    prev
                      ? `v${prev.workflowVersionId} → v${iter.workflowVersionId}`
                      : `→ v${iter.workflowVersionId}`
                  }
                  original={prev?.value ?? null}
                  updated={iter.value}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Names the "before" side of a diff. A baseline taken from the task's own chain
 * (or from the version that simply came before it) is not what is live — only a
 * published baseline may be labelled as published.
 */
function baselineLabelFor(
  snapshot: { versionNumber: number; source?: ChangeBaselineSource } | null | undefined,
): string | undefined {
  if (!snapshot) return undefined;
  return snapshot.source === "chain" || snapshot.source === "prior"
    ? `vs v${snapshot.versionNumber}`
    : `vs published v${snapshot.versionNumber}`;
}

// ── StackedDiff ───────────────────────────────────────────────────────────────
// The prompt/script equivalent of WorkflowSectionBody's two views over one chain:
//   • overall — the version the task started from → the latest version
//   • steps   — previous version → this version, per landed version
// Both the captured-snapshot path and the live-reconstruction path below feed
// this same component, so an item always reads the same way whichever resolved it.

type DiffStep = { key: string; versionNumber?: number; value: string | null };

function StackedDiff({
  kind,
  baselineValue,
  baselineVersionNumber,
  baselineLabel,
  steps,
}: {
  kind: Exclude<ChangeKind, "workflow">;
  baselineValue: string | null;
  baselineVersionNumber?: number;
  baselineLabel?: string;
  steps: DiffStep[];
}) {
  const [stepsOpen, setStepsOpen] = useState(false);

  const latest = steps[steps.length - 1];

  return (
    <div className="flex flex-col">
      {/* Overall diff: baseline → latest ("all changes done") */}
      <div className="h-80">
        <DiffView
          original={baselineValue}
          updated={latest.value}
          label={kind}
          baselineLabel={baselineLabel}
        />
      </div>

      {/* Per-version steps ("each change along the way"), each collapsible.
          Shown whenever versions landed, so a single change can still be
          inspected on its own terms. */}
      <div className="border-t border-border">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors text-left"
          onClick={() => setStepsOpen((o) => !o)}
          data-testid={`${kind}-steps-toggle`}
        >
          {stepsOpen ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
          )}
          <Layers className="w-3 h-3 flex-shrink-0" />
          <span>
            {steps.length} iteration{steps.length !== 1 ? "s" : ""}
            {latest.versionNumber !== undefined ? ` (up to v${latest.versionNumber})` : ""}
          </span>
        </button>

        {stepsOpen && (
          <div className="divide-y divide-border/60">
            {steps.map((step, idx) => {
              const prev =
                idx === 0
                  ? { value: baselineValue, versionNumber: baselineVersionNumber }
                  : steps[idx - 1];

              const stepLabel =
                prev.versionNumber !== undefined && step.versionNumber !== undefined
                  ? `v${prev.versionNumber} → v${step.versionNumber}`
                  : step.versionNumber !== undefined
                    ? `→ v${step.versionNumber}`
                    : `Step ${idx + 1}`;

              return (
                <StepDiff
                  key={step.key}
                  kind={kind}
                  index={idx}
                  label={stepLabel}
                  original={prev.value}
                  updated={step.value}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PromptSectionBody ─────────────────────────────────────────────────────────
// Three paths, in order of fidelity:
//   1. captured snapshots — frozen at ingestion, never drifts
//   2. live reconstruction — the same stacked view rebuilt from the versions
//      list, for artifacts that were never enriched
//   3. legacy single diff — last resort when neither can resolve a chain
// All hooks are called unconditionally so the path can change between renders.

const NO_ITERATIONS: PromptIteration[] = [];

function PromptSectionBody({ item }: { item: PromptChangedItem }) {
  const iterations = item.iterations ?? NO_ITERATIONS;

  // Snapshots are only trusted when the whole chain was captured: mixing a
  // frozen version with a live baseline is how a published change ends up
  // diffing against itself.
  const hasSnapshots =
    iterations.length > 0 &&
    item.baselineSnapshot !== undefined &&
    iterations.every((it) => it.value !== undefined);

  const versionIds = useMemo(
    () => iterations.map((it) => it.promptVersionId),
    [iterations],
  );

  // Live reconstruction — runs only when snapshots are missing.
  const chain = usePromptVersionChain(item.promptId, versionIds, !hasSnapshots);

  // Last-resort single diff. Snapshots are passed through so this never fires a
  // network call on the snapshot path.
  const legacyBaseline = useItemBaseline({
    type: "PROMPT",
    promptId: item.promptId,
    promptVersionId: item.promptVersionId,
    baselineSnapshot: item.baselineSnapshot,
    versionSnapshot:
      hasSnapshots && iterations.length > 0
        ? {
            value: iterations[iterations.length - 1].value!,
            versionNumber: iterations[iterations.length - 1].versionNumber ?? 0,
          }
        : undefined,
  });

  // ── 1. Captured snapshots ───────────────────────────────────────────────────
  if (hasSnapshots) {
    return (
      <StackedDiff
        kind="prompt"
        baselineValue={item.baselineSnapshot?.value ?? null}
        baselineVersionNumber={item.baselineSnapshot?.versionNumber}
        baselineLabel={baselineLabelFor(item.baselineSnapshot)}
        steps={iterations.map((iter) => ({
          key: iter.promptVersionId,
          versionNumber: iter.versionNumber,
          value: iter.value ?? null,
        }))}
      />
    );
  }

  // ── 2. Live reconstruction ──────────────────────────────────────────────────
  if (chain.isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-muted-foreground text-sm animate-pulse">Loading diff…</span>
      </div>
    );
  }

  if (chain.iterations.length > 0) {
    return (
      <StackedDiff
        kind="prompt"
        baselineValue={chain.baseline?.value ?? null}
        baselineVersionNumber={chain.baseline?.versionNumber}
        baselineLabel={
          chain.baseline ? `vs v${chain.baseline.versionNumber}` : undefined
        }
        steps={chain.iterations.map((entry) => ({
          key: entry.versionId,
          versionNumber: entry.versionNumber,
          value: entry.value,
        }))}
      />
    );
  }

  // ── 3. Legacy single diff ───────────────────────────────────────────────────
  const { baseline, updated, isLoading, error, baselineLabel } = legacyBaseline;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-muted-foreground text-sm animate-pulse">Loading diff…</span>
      </div>
    );
  }

  if (error && !updated) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-destructive text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="h-80">
      <DiffView
        original={baseline}
        updated={updated}
        label="prompt"
        baselineLabel={baselineLabel ?? undefined}
      />
    </div>
  );
}

// ── ScriptSectionBody ─────────────────────────────────────────────────────────
// Same three paths as prompts, in order of fidelity:
//   1. captured snapshots — frozen at ingestion, never drifts
//   2. live reconstruction — the stacked view rebuilt from Stakwork's versions
//   3. legacy single diff — last resort when neither can resolve a chain
// Script bodies live in Stakwork rather than Hive's DB, so path 2 costs one
// request per version; snapshots are what keep that off the common path.

const NO_SCRIPT_ITERATIONS: ScriptIteration[] = [];

function ScriptSectionBody({ item }: { item: ScriptChangedItem }) {
  const iterations = item.iterations ?? NO_SCRIPT_ITERATIONS;

  const hasSnapshots =
    iterations.length > 0 &&
    item.baselineSnapshot !== undefined &&
    iterations.every((it) => it.value !== undefined);

  const versionIds = useMemo(
    () => iterations.map((it) => it.scriptVersionId),
    [iterations],
  );

  const chain = useScriptVersionChain(item.scriptId, versionIds, !hasSnapshots);

  // Last-resort single diff — only reached when the chain can't be rebuilt.
  const legacyBaseline = useItemBaseline({
    type: "SCRIPT",
    scriptId: item.scriptId,
    scriptVersionId: item.scriptVersionId,
  });

  // ── 1. Captured snapshots ───────────────────────────────────────────────────
  if (hasSnapshots) {
    return (
      <StackedDiff
        kind="script"
        baselineValue={item.baselineSnapshot?.value ?? null}
        baselineVersionNumber={item.baselineSnapshot?.versionNumber}
        baselineLabel={baselineLabelFor(item.baselineSnapshot)}
        steps={iterations.map((iter) => ({
          key: String(iter.scriptVersionId),
          versionNumber: iter.versionNumber,
          value: iter.value ?? null,
        }))}
      />
    );
  }

  // ── 2. Live reconstruction ──────────────────────────────────────────────────
  if (chain.isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-muted-foreground text-sm animate-pulse">Loading diff…</span>
      </div>
    );
  }

  if (chain.iterations.length > 0) {
    return (
      <StackedDiff
        kind="script"
        baselineValue={chain.baseline?.value ?? null}
        baselineVersionNumber={chain.baseline?.versionNumber}
        baselineLabel={chain.baseline ? `vs v${chain.baseline.versionNumber}` : undefined}
        steps={chain.iterations.map((entry) => ({
          key: String(entry.versionId),
          versionNumber: entry.versionNumber,
          value: entry.value,
        }))}
      />
    );
  }

  // The legacy path below reads the same endpoints the chain just failed on, so
  // retrying it would only repeat the failure under a vaguer message.
  if (chain.error) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-destructive text-sm">{chain.error}</span>
      </div>
    );
  }

  // ── 3. Legacy single diff ───────────────────────────────────────────────────
  const { baseline, updated, isLoading, error } = legacyBaseline;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-muted-foreground text-sm animate-pulse">Loading diff…</span>
      </div>
    );
  }

  if (error && !updated) {
    return (
      <div className="flex items-center justify-center p-6">
        <span className="text-destructive text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="h-80">
      <DiffView original={baseline} updated={updated} label="script" />
    </div>
  );
}

// ── CollapsibleChangeSection ──────────────────────────────────────────────────

interface CollapsibleChangeSectionProps {
  item: ChangedItem;
  defaultOpen: boolean;
}

function CollapsibleChangeSection({ item, defaultOpen }: CollapsibleChangeSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Countable whenever both sides of the overall change are already in hand:
  // any workflow item, and any prompt/script item with captured snapshots. Items
  // that resolve their sides asynchronously carry no badge — the expanded diff
  // shows the counts once it loads.
  // The counts always describe the overall change (baseline → latest).
  const stats = useMemo(() => {
    if (item.type === "WORKFLOW") {
      return item.iterations?.length
        ? countAddDel(
            item.baselineSnapshot?.value ?? null,
            item.iterations[item.iterations.length - 1].value,
          )
        : countAddDel(item.originalJson, item.updatedJson);
    }

    const latest = item.iterations?.[item.iterations.length - 1];
    if (latest?.value === undefined) return null; // legacy: sides come from a live lookup
    return countAddDel(item.baselineSnapshot?.value ?? null, latest.value);
  }, [item]);

  // Multi-iteration badge for any grouped item
  const iterationCount = item.iterations?.length ?? 0;
  const isMultiIteration = iterationCount > 1;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border last:border-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
          data-testid={`changes-section-${item.type.toLowerCase()}-${item.name}`}
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          {itemIcon(item.type)}
          <span className="flex-1 text-sm font-medium truncate">
            {itemLabel(item.type)}{" "}
            <span className="text-muted-foreground font-normal">— {item.name}</span>
          </span>
          {isMultiIteration && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
              data-testid="multi-iteration-badge"
            >
              <Layers className="w-3 h-3" />
              {iterationCount}
            </span>
          )}
          {stats && (
            <AddDelBadge additions={stats.additions} deletions={stats.deletions} />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {item.type === "WORKFLOW" && <WorkflowSectionBody item={item} />}
        {item.type === "PROMPT" && <PromptSectionBody item={item} />}
        {item.type === "SCRIPT" && <ScriptSectionBody item={item} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── ChangesList ───────────────────────────────────────────────────────────────

export interface ChangesListProps {
  items: ChangedItem[];
}

export function ChangesList({ items }: ChangesListProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No changes to display</div>
      </div>
    );
  }

  const autoExpand = items.length === 1;

  return (
    <div className="h-full overflow-auto" data-testid="changes-list">
      {items.map((item, index) => {
        const key =
          item.type === "WORKFLOW"
            ? `workflow-${item.name}-${index}`
            : item.type === "PROMPT"
              ? `prompt-${item.promptId}`
              : `script-${item.scriptId}-${item.scriptVersionId}`;

        return (
          <CollapsibleChangeSection
            key={key}
            item={item}
            defaultOpen={autoExpand}
          />
        );
      })}
    </div>
  );
}
