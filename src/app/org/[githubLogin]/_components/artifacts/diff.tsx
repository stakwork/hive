"use client";

/**
 * MultiFileDiffView — shared multi-file patch renderer usable from both
 * the task artifact view and the org-canvas ProposalCard.
 *
 * Lifted out of the task-route diff.tsx so that route-specific CSS/theme/
 * language-bundle dependencies are NOT dragged into the org-canvas bundle.
 * Uses only Tailwind classes (no DiffArtifact.css import) and the same
 * react-diff-view primitives.
 */

import React, { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk, DiffType, HunkData } from "react-diff-view";
import type { ActionResult } from "@/lib/chat";
import {
  FilePlus,
  FileEdit,
  FileX,
  FileCode,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import "react-diff-view/style/index.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type Action = ActionResult["action"];

interface ParsedFile {
  fileName: string;
  action: Action;
  repoName: string;
  type: DiffType;
  hunks: HunkData[];
  hasError: boolean;
  errorMessage?: string;
  additions: number;
  deletions: number;
}

const EMPTY_HUNKS: HunkData[] = [];

// ─── Action icon helper ───────────────────────────────────────────────────────

function getActionInfo(action: Action) {
  switch (action) {
    case "create":
      return {
        icon: FilePlus,
        color: "text-green-600 dark:text-green-400",
        label: "Created",
      };
    case "delete":
      return {
        icon: FileX,
        color: "text-red-600 dark:text-red-400",
        label: "Deleted",
      };
    case "rewrite":
      return {
        icon: FileCode,
        color: "text-blue-600 dark:text-blue-400",
        label: "Rewritten",
      };
    default:
      return {
        icon: FileEdit,
        color: "text-yellow-600 dark:text-yellow-400",
        label: "Modified",
      };
  }
}

// ─── Parse helper ─────────────────────────────────────────────────────────────

function parseDiffs(diffs: ActionResult[]): ParsedFile[] {
  return diffs.flatMap((diff): ParsedFile[] => {
    try {
      if (!diff.content || diff.content.trim() === "") {
        return [
          {
            fileName: diff.file,
            action: diff.action,
            repoName: diff.repoName,
            type: "modify" as DiffType,
            hunks: EMPTY_HUNKS,
            hasError: true,
            errorMessage: "No diff content available",
            additions: 0,
            deletions: 0,
          },
        ];
      }

      const parsed = parseDiff(diff.content, { nearbySequences: "zip" });

      return parsed.map((file): ParsedFile => {
        let additions = 0;
        let deletions = 0;
        file.hunks?.forEach((hunk) => {
          additions += hunk.changes.filter((c) => c.type === "insert").length;
          deletions += hunk.changes.filter((c) => c.type === "delete").length;
        });

        return {
          fileName: diff.file,
          action: diff.action,
          repoName: diff.repoName,
          type: file.type,
          hunks: file.hunks || EMPTY_HUNKS,
          hasError: false,
          additions,
          deletions,
        };
      });
    } catch (err) {
      return [
        {
          fileName: diff.file,
          action: diff.action,
          repoName: diff.repoName,
          type: "modify" as DiffType,
          hunks: EMPTY_HUNKS,
          hasError: true,
          errorMessage:
            err instanceof Error ? err.message : "Failed to parse diff",
          additions: 0,
          deletions: 0,
        },
      ];
    }
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

interface MultiFileDiffViewProps {
  /** Array of ActionResult objects (file diffs). */
  diffs: ActionResult[];
  /** Max height for the scrollable container. Defaults to "60vh". */
  maxHeight?: string;
  className?: string;
}

/**
 * Renders a multi-file git patch as an expandable file list.
 * Each file can be expanded/collapsed independently. All start expanded.
 *
 * Designed for use in the org-canvas ProposalCard — no route-specific
 * CSS is imported.
 */
export function MultiFileDiffView({
  diffs,
  maxHeight = "60vh",
  className = "",
}: MultiFileDiffViewProps) {
  const parsedFiles = useMemo(() => parseDiffs(diffs), [diffs]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(parsedFiles.map((f) => f.fileName)),
  );

  // Keep expansion state in sync when diffs change (e.g. on re-propose).
  React.useEffect(() => {
    setExpandedFiles(new Set(parsedFiles.map((f) => f.fileName)));
  }, [parsedFiles]);

  const toggleFile = (fileName: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) {
        next.delete(fileName);
      } else {
        next.add(fileName);
      }
      return next;
    });
  };

  const totalStats = useMemo(
    () =>
      parsedFiles.reduce(
        (acc, f) => ({
          files: acc.files + 1,
          additions: acc.additions + f.additions,
          deletions: acc.deletions + f.deletions,
        }),
        { files: 0, additions: 0, deletions: 0 },
      ),
    [parsedFiles],
  );

  if (parsedFiles.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        No changes to display
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Summary row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground px-1">
        <span>{totalStats.files} file{totalStats.files !== 1 ? "s" : ""}</span>
        <span className="text-emerald-600 dark:text-emerald-400">
          +{totalStats.additions}
        </span>
        <span className="text-rose-600 dark:text-rose-400">
          −{totalStats.deletions}
        </span>
      </div>

      {/* File list */}
      <div
        className="overflow-auto rounded border border-border"
        style={{ maxHeight }}
      >
        {parsedFiles.map((file, idx) => {
          const { icon: ActionIcon, color, label } = getActionInfo(file.action);
          const isExpanded = expandedFiles.has(file.fileName);

          return (
            <div
              key={`${file.fileName}-${idx}`}
              className="border-b border-border last:border-b-0 bg-card"
            >
              {/* File header */}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors"
                onClick={() => toggleFile(file.fileName)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                )}
                <span className={`flex items-center gap-1 ${color} flex-shrink-0`}>
                  <ActionIcon className="h-3 w-3" />
                  <span className="uppercase tracking-wider font-medium hidden sm:inline">
                    {label}
                  </span>
                </span>
                <span className="font-mono truncate flex-1 text-foreground">
                  {file.fileName}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0 font-mono ml-2">
                  {file.additions > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{file.additions}
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-rose-600 dark:text-rose-400">
                      −{file.deletions}
                    </span>
                  )}
                </span>
              </button>

              {/* Diff body */}
              {isExpanded && (
                <div className="border-t border-border">
                  {file.hasError && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{file.errorMessage ?? "Failed to render diff"}</span>
                    </div>
                  )}
                  {!file.hasError && file.hunks.length > 0 && (
                    <div className="overflow-x-auto text-xs">
                      <Diff
                        viewType="unified"
                        diffType={file.type}
                        hunks={file.hunks}
                      >
                        {(hunks) =>
                          hunks.map((hunk) => (
                            <Hunk key={hunk.content} hunk={hunk} />
                          ))
                        }
                      </Diff>
                    </div>
                  )}
                  {!file.hasError && file.hunks.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground italic">
                      No changes in this file
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
