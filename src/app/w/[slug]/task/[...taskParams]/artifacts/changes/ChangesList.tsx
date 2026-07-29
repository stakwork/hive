"use client";

import React, { useState } from "react";
import { FileCode, AlignLeft, Code2, ChevronDown, ChevronRight, Plus, Minus, Layers } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { DiffView } from "./DiffView";
import { useItemBaseline } from "@/hooks/useItemBaseline";

// ── Item types ────────────────────────────────────────────────────────────────

export type WorkflowChangedItem = {
  type: "WORKFLOW";
  name: string;
  originalJson: string | object | null;
  updatedJson: string | object | null;
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
  /** Baseline snapshot from the earliest iteration (published version when first change was created). */
  baselineSnapshot?: { value: string; versionId: string; versionNumber: number } | null;
};

export type ScriptChangedItem = {
  type: "SCRIPT";
  name: string;
  scriptId: number;
  scriptVersionId: number;
};

export type ChangedItem = WorkflowChangedItem | PromptChangedItem | ScriptChangedItem;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStr(v: string | object | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}

/** Count add/del lines between two plain strings using the same approach as DiffView. */
export function countAddDel(
  original: string | object | null,
  updated: string | object | null,
): { additions: number; deletions: number } {
  if (!updated) return { additions: 0, deletions: 0 };

  // Minimal line-level count — mirrors DiffView logic without importing the whole component
  const origLines = toStr(original).split("\n");
  const updLines = toStr(updated).split("\n");

  // Very rough LCS-based count — sufficient for badge display
  // Reuse diffLines from the "diff" package (same dep as DiffView)
  // We avoid importing diffLines here; instead we compute a simple heuristic:
  // additions ≈ lines in updated not in original, deletions ≈ the reverse.
  // For accuracy we just report: additions = max(0, updLines - origLines), etc.
  // This is intentionally approximate for the header badge.
  const additions = Math.max(0, updLines.length - origLines.length);
  const deletions = Math.max(0, origLines.length - updLines.length);
  return { additions, deletions };
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

// ── PromptSectionBody ─────────────────────────────────────────────────────────
// Handles both the new stacked multi-iteration case and the legacy single-item fallback.
// useItemBaseline is called unconditionally (once) and used only for the legacy path;
// this satisfies React rules-of-hooks regardless of iteration count.

function PromptSectionBody({ item }: { item: PromptChangedItem }) {
  const [stepsOpen, setStepsOpen] = useState(false);

  // Always call useItemBaseline — used only when snapshots are absent (legacy path).
  // For the snapshot path this result is ignored.
  const legacyBaseline = useItemBaseline({
    type: "PROMPT",
    promptId: item.promptId,
    promptVersionId: item.promptVersionId,
    // Pass snapshots through when present so the hook skips the network call even here
    baselineSnapshot: item.baselineSnapshot,
    versionSnapshot: item.iterations?.[item.iterations.length - 1]?.value !== undefined
      ? {
          value: item.iterations![item.iterations!.length - 1].value!,
          versionNumber: item.iterations![item.iterations!.length - 1].versionNumber ?? 0,
        }
      : undefined,
  });

  const iterations = item.iterations;
  const hasIterations = iterations && iterations.length > 0;

  // ── Snapshot path ────────────────────────────────────────────────────────────
  // We have at least the versionSnapshot on the (latest) iteration.
  if (hasIterations && iterations[iterations.length - 1].value !== undefined) {
    const latestIteration = iterations[iterations.length - 1];
    const latestValue = latestIteration.value!;
    const latestVersionNumber = latestIteration.versionNumber;

    // baselineSnapshot: undefined = absent field (legacy); null = no published version (new prompt)
    const baselinePresent = item.baselineSnapshot !== undefined;
    const baselineValue = item.baselineSnapshot?.value ?? null;
    const baselineLabel =
      item.baselineSnapshot != null && item.baselineSnapshot !== undefined
        ? `vs published v${item.baselineSnapshot.versionNumber}`
        : undefined;

    const isMultiIteration = iterations.length > 1;

    return (
      <div className="flex flex-col">
        {/* Overall diff: baseline → latest */}
        <div className="h-80">
          <DiffView
            original={baselinePresent ? baselineValue : legacyBaseline.baseline}
            updated={latestValue}
            label="prompt"
            baselineLabel={baselineLabel}
          />
        </div>

        {/* Consecutive step diffs (expandable) — only when multi-iteration */}
        {isMultiIteration && (
          <div className="border-t border-border">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors text-left"
              onClick={() => setStepsOpen((o) => !o)}
              data-testid="prompt-steps-toggle"
            >
              {stepsOpen ? (
                <ChevronDown className="w-3 h-3 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 flex-shrink-0" />
              )}
              <Layers className="w-3 h-3 flex-shrink-0" />
              <span>
                {iterations.length} iteration{iterations.length !== 1 ? "s" : ""}
                {latestVersionNumber !== undefined
                  ? ` (up to v${latestVersionNumber})`
                  : ""}
              </span>
            </button>

            {stepsOpen && (
              <div className="divide-y divide-border/60">
                {iterations.map((iter, idx) => {
                  const prevValue =
                    idx === 0
                      ? (item.baselineSnapshot?.value ?? null)
                      : (iterations[idx - 1].value ?? null);
                  const currValue = iter.value ?? null;
                  const prevNum =
                    idx === 0
                      ? item.baselineSnapshot?.versionNumber
                      : iterations[idx - 1].versionNumber;
                  const currNum = iter.versionNumber;

                  const stepLabel =
                    prevNum !== undefined && currNum !== undefined
                      ? `v${prevNum} → v${currNum}`
                      : currNum !== undefined
                        ? `→ v${currNum}`
                        : `Step ${idx + 1}`;

                  return (
                    <div
                      key={iter.promptVersionId}
                      className="px-4 py-3"
                      data-testid={`prompt-step-${idx}`}
                    >
                      <div className="text-xs font-mono text-muted-foreground mb-2">
                        {stepLabel}
                      </div>
                      <div className="h-60">
                        <DiffView
                          original={prevValue}
                          updated={currValue}
                          label="prompt"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Legacy path: no versionSnapshot — fall back to live lookup ───────────────
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

// ── Script section body (calls useItemBaseline) ───────────────────────────────

function ScriptSectionBody({ item }: { item: ScriptChangedItem }) {
  const { baseline, updated, isLoading, error } = useItemBaseline({
    type: "SCRIPT",
    scriptId: item.scriptId,
    scriptVersionId: item.scriptVersionId,
  });

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

  // For workflow items we can compute counts synchronously; for prompt/script we
  // approximate from names/ids (the DiffView itself shows precise counts when expanded).
  const stats =
    item.type === "WORKFLOW"
      ? countAddDel(item.originalJson, item.updatedJson)
      : { additions: 0, deletions: 0 };

  const showBadge = item.type === "WORKFLOW";

  // Show multi-iteration badge for grouped prompt items
  const isMultiIterationPrompt =
    item.type === "PROMPT" &&
    item.iterations !== undefined &&
    item.iterations.length > 1;

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
          {isMultiIterationPrompt && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
              data-testid="multi-iteration-badge"
            >
              <Layers className="w-3 h-3" />
              {item.iterations!.length}
            </span>
          )}
          {showBadge && (
            <AddDelBadge additions={stats.additions} deletions={stats.deletions} />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {item.type === "WORKFLOW" && (
          <div className="h-80">
            <DiffView
              original={item.originalJson}
              updated={item.updatedJson}
              label="workflow"
            />
          </div>
        )}
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
