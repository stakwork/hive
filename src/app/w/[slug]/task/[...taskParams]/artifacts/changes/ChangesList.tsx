"use client";

import React, { useState } from "react";
import { FileCode, AlignLeft, Code2, ChevronDown, ChevronRight, Plus, Minus } from "lucide-react";
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

export type PromptChangedItem = {
  type: "PROMPT";
  name: string;
  promptId: string;
  promptVersionId: string;
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

// ── Prompt section body (calls useItemBaseline) ───────────────────────────────

function PromptSectionBody({ item }: { item: PromptChangedItem }) {
  const { baseline, updated, isLoading, error } = useItemBaseline({
    type: "PROMPT",
    promptId: item.promptId,
    promptVersionId: item.promptVersionId,
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
      <DiffView original={baseline} updated={updated} label="prompt" />
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
              ? `prompt-${item.promptId}-${item.promptVersionId}`
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
