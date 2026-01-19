"use client";

import React, { useMemo } from "react";
import { useTheme } from "@/hooks/use-theme";
import { diffLines } from "diff";
import { FileCode, Plus, Minus, Equal } from "lucide-react";

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

interface WorkflowChangesPanelProps {
  originalJson: string | null;
  updatedJson: string | null;
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

    // Format with consistent indentation
    return JSON.stringify(data, null, 2);
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

  const { changes, stats } = useMemo(() => {
    const original = parseAndFormat(originalJson);
    const updated = parseAndFormat(updatedJson);

    if (!original && !updated) {
      return { changes: [] as DiffPart[], stats: { additions: 0, deletions: 0 } };
    }

    const diff = diffLines(original, updated) as DiffPart[];

    let additions = 0;
    let deletions = 0;

    diff.forEach((part: DiffPart) => {
      const lines = part.value.split('\n').filter((l: string) => l.length > 0).length;
      if (part.added) additions += lines;
      if (part.removed) deletions += lines;
    });

    return { changes: diff, stats: { additions, deletions } };
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
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Plus className="w-3 h-3" />
            {stats.additions}
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <Minus className="w-3 h-3" />
            {stats.deletions}
          </span>
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
            {changes.map((part: DiffPart, index: number) => {
              const lines = part.value.split('\n');
              // Remove last empty line from split
              if (lines[lines.length - 1] === '') {
                lines.pop();
              }

              return lines.map((line: string, lineIndex: number) => {
                let bgColor = "";
                let textColor = "";
                let prefix = " ";
                let Icon: typeof Plus | typeof Minus | null = null;

                if (part.added) {
                  bgColor = isDark ? "bg-green-950/50" : "bg-green-50";
                  textColor = isDark ? "text-green-300" : "text-green-800";
                  prefix = "+";
                  Icon = Plus;
                } else if (part.removed) {
                  bgColor = isDark ? "bg-red-950/50" : "bg-red-50";
                  textColor = isDark ? "text-red-300" : "text-red-800";
                  prefix = "-";
                  Icon = Minus;
                }

                return (
                  <tr key={`${index}-${lineIndex}`} className={bgColor}>
                    <td className={`w-8 px-2 py-0.5 text-right select-none border-r border-border/50 ${textColor || "text-muted-foreground"}`}>
                      {Icon && <Icon className="w-3 h-3 inline" />}
                      {!Icon && <span className="opacity-30">{prefix}</span>}
                    </td>
                    <td className={`px-3 py-0.5 whitespace-pre ${textColor}`}>
                      {line || " "}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
