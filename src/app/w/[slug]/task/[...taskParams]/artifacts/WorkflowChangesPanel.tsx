"use client";

import React, { useMemo, useState } from "react";
import { useTheme } from "@/hooks/use-theme";
import { diffLines } from "diff";
import { FileCode, Plus, Minus, Equal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

interface FlatLine {
  type: 'added' | 'removed' | 'context' | 'separator';
  content: string;
}

interface WorkflowChangesPanelProps {
  originalJson: string | null;
  updatedJson: string | null;
}

const NOISE_FIELDS = ["position", "unique_id", "subskill_id", "skill_icon"] as const;

function omitNoiseFields(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  const transitions = obj.transitions;
  if (!transitions || typeof transitions !== "object" || Array.isArray(transitions)) return data;

  const cleanedTransitions: Record<string, unknown> = {};
  for (const [key, step] of Object.entries(transitions as Record<string, unknown>)) {
    if (step && typeof step === "object" && !Array.isArray(step)) {
      const cleaned = { ...(step as Record<string, unknown>) };
      for (const field of NOISE_FIELDS) delete cleaned[field];
      cleanedTransitions[key] = cleaned;
    } else {
      cleanedTransitions[key] = step;
    }
  }

  return { ...obj, transitions: cleanedTransitions };
}

function parseAndFormat(jsonString: string | null): string {
  if (!jsonString) return "";

  try {
    let data: unknown = jsonString;

    // Handle double-encoded JSON
    if (typeof data === "string") {
      // Remove wrapper quotes
      if (data.startsWith('\\"') && data.endsWith('\\"')) {
        data = data.slice(2, -2);
      } else if (data.startsWith('"') && data.endsWith('"')) {
        data = data.slice(1, -1);
      }

      // Parse until we get an object
      while (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          break;
        }
      }
    }

    // Format with consistent indentation (noise fields stripped)
    return JSON.stringify(omitNoiseFields(data), null, 2);
  } catch (e) {
    console.error("Failed to parse JSON:", e);
    return jsonString;
  }
}

const hideScrollbarStyle: React.CSSProperties = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
};

export function WorkflowChangesPanel({ originalJson, updatedJson }: WorkflowChangesPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [viewMode, setViewMode] = useState<'diff' | 'full'>('diff');

  const { changes, contextLines, stats } = useMemo(() => {
    const original = parseAndFormat(originalJson);
    const updated = parseAndFormat(updatedJson);

    if (!original && !updated) {
      return { changes: [] as DiffPart[], contextLines: [] as FlatLine[], stats: { additions: 0, deletions: 0 } };
    }

    const diff = diffLines(original, updated) as DiffPart[];

    let additions = 0;
    let deletions = 0;

    diff.forEach((part: DiffPart) => {
      const lines = part.value.split('\n').filter((l: string) => l.length > 0).length;
      if (part.added) additions += lines;
      if (part.removed) deletions += lines;
    });

    // Build flat line array with context for diff mode
    const CONTEXT = 5;
    const flat: FlatLine[] = [];

    diff.forEach((part: DiffPart, i: number) => {
      const lines = part.value.split('\n');
      // Remove trailing empty string from split
      if (lines[lines.length - 1] === '') lines.pop();

      if (part.added) {
        lines.forEach((line) => flat.push({ type: 'added', content: line }));
      } else if (part.removed) {
        lines.forEach((line) => flat.push({ type: 'removed', content: line }));
      } else {
        // Unchanged chunk — determine how much context to show
        const prevChanged = i > 0 && (diff[i - 1].added || diff[i - 1].removed);
        const nextChanged = i < diff.length - 1 && (diff[i + 1].added || diff[i + 1].removed);

        if (!prevChanged && !nextChanged) return; // no adjacent changes — skip entirely

        if (prevChanged && nextChanged) {
          if (lines.length <= CONTEXT * 2) {
            // Short enough to show in full
            lines.forEach((line) => flat.push({ type: 'context', content: line }));
          } else {
            // Show trailing context of previous change + separator + leading context of next change
            lines.slice(0, CONTEXT).forEach((line) => flat.push({ type: 'context', content: line }));
            flat.push({ type: 'separator', content: '...' });
            lines.slice(-CONTEXT).forEach((line) => flat.push({ type: 'context', content: line }));
          }
        } else if (prevChanged) {
          // Only show leading context (first N lines after the prev change)
          lines.slice(0, CONTEXT).forEach((line) => flat.push({ type: 'context', content: line }));
        } else {
          // nextChanged only — show trailing context (last N lines before the next change)
          lines.slice(-CONTEXT).forEach((line) => flat.push({ type: 'context', content: line }));
        }
      }
    });

    return { changes: diff, contextLines: flat, stats: { additions, deletions } };
  }, [originalJson, updatedJson]);

  if (!originalJson && !updatedJson) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No workflow data available for comparison</div>
      </div>
    );
  }

  if (!originalJson) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No original workflow to compare against</div>
      </div>
    );
  }

  if (!updatedJson) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-muted-foreground text-sm">No updated workflow available</div>
      </div>
    );
  }

  const hasChanges = stats.additions > 0 || stats.deletions > 0;

  if (!hasChanges) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <Equal className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <div className="text-muted-foreground text-sm">No changes detected</div>
          <div className="text-muted-foreground text-xs mt-1">The workflow JSON is identical</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isDark ? "dark" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <FileCode className="w-5 h-5" />
          <span className="text-sm font-medium">Workflow Changes</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs">
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Plus className="w-3 h-3" />
              {stats.additions}
            </span>
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <Minus className="w-3 h-3" />
              {stats.deletions}
            </span>
          </div>
          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 rounded-none px-2 text-xs border-r border-border ${
                viewMode === 'diff'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setViewMode('diff')}
            >
              Changes only
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 rounded-none px-2 text-xs ${
                viewMode === 'full'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setViewMode('full')}
            >
              Full JSON
            </Button>
          </div>
        </div>
      </div>

      {/* Diff content */}
      <div
        className="flex-1 overflow-auto font-mono text-xs"
        style={hideScrollbarStyle}
      >
        <style>{`
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        <table className="w-full border-collapse hide-scrollbar">
          <tbody>
            {viewMode === 'diff'
              ? contextLines.map((entry: FlatLine, index: number) => {
                  if (entry.type === 'separator') {
                    return (
                      <tr key={`sep-${index}`}>
                        <td colSpan={2} className="text-muted-foreground text-center py-0.5 text-xs select-none border-y border-border/30">
                          ...
                        </td>
                      </tr>
                    );
                  }

                  let bgColor = "";
                  let textColor = "";
                  let Icon: typeof Plus | typeof Minus | null = null;

                  if (entry.type === 'added') {
                    bgColor = isDark ? "bg-green-950/50" : "bg-green-50";
                    textColor = isDark ? "text-green-300" : "text-green-800";
                    Icon = Plus;
                  } else if (entry.type === 'removed') {
                    bgColor = isDark ? "bg-red-950/50" : "bg-red-50";
                    textColor = isDark ? "text-red-300" : "text-red-800";
                    Icon = Minus;
                  }

                  return (
                    <tr key={`flat-${index}`} className={bgColor}>
                      <td className={`w-8 px-2 py-0.5 text-right select-none border-r border-border/50 ${textColor || "text-muted-foreground"}`}>
                        {Icon ? <Icon className="w-3 h-3 inline" /> : <span className="opacity-30"> </span>}
                      </td>
                      <td className={`px-3 py-0.5 whitespace-pre ${textColor || "text-muted-foreground/50"}`}>
                        {entry.content || " "}
                      </td>
                    </tr>
                  );
                })
              : changes.map((part: DiffPart, index: number) => {
                  const lines = part.value.split('\n');
                  if (lines[lines.length - 1] === '') lines.pop();

                  return lines.map((line: string, lineIndex: number) => {
                    let bgColor = "";
                    let textColor = "";
                    let Icon: typeof Plus | typeof Minus | null = null;

                    if (part.added) {
                      bgColor = isDark ? "bg-green-950/50" : "bg-green-50";
                      textColor = isDark ? "text-green-300" : "text-green-800";
                      Icon = Plus;
                    } else if (part.removed) {
                      bgColor = isDark ? "bg-red-950/50" : "bg-red-50";
                      textColor = isDark ? "text-red-300" : "text-red-800";
                      Icon = Minus;
                    }

                    return (
                      <tr key={`${index}-${lineIndex}`} className={bgColor}>
                        <td className={`w-8 px-2 py-0.5 text-right select-none border-r border-border/50 ${textColor || "text-muted-foreground"}`}>
                          {Icon ? <Icon className="w-3 h-3 inline" /> : <span className="opacity-30"> </span>}
                        </td>
                        <td className={`px-3 py-0.5 whitespace-pre ${textColor || "text-muted-foreground/50"}`}>
                          {line || " "}
                        </td>
                      </tr>
                    );
                  });
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
