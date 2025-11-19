"use client";

import React, { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk, DiffType, HunkData } from "react-diff-view";
import { Artifact, DiffContent, Action, ActionResult } from "@/lib/chat";
import { useTheme } from "@/hooks/use-theme";
import {
  FilePlus,
  FileEdit,
  FileX,
  FileCode,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  AlertCircle
} from "lucide-react";
import "./DiffArtifact.css";

interface DiffArtifactPanelProps {
  artifacts: Artifact[];
  viewType?: "split" | "unified";
  className?: string;
}

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

export function DiffArtifactPanel({ artifacts, viewType: initialViewType = "unified", className = "" }: DiffArtifactPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [viewType, setViewType] = useState<"split" | "unified">(initialViewType);

  // Load view preference from localStorage on mount
  React.useEffect(() => {
    const saved = localStorage.getItem("diff_view_preference");
    if (saved === "split" || saved === "unified") {
      setViewType(saved);
    }
  }, []);

  // Get all diffs from all artifacts
  const allDiffs = useMemo(() => {
    return artifacts.flatMap((artifact) => {
      const content = artifact.content as DiffContent;
      return content?.diffs || [];
    });
  }, [artifacts]);

  // Parse all diffs and handle errors
  const parsedFiles = useMemo<ParsedFile[]>(() => {
    return allDiffs.flatMap((diff: ActionResult): ParsedFile[] => {
      try {
        if (!diff.content || diff.content.trim() === "") {
          return [
            {
              fileName: diff.file,
              action: diff.action,
              repoName: diff.repoName,
              type: "modify" as DiffType,
              hunks: EMPTY_HUNKS,
              hasError: true as boolean,
              errorMessage: "No diff content available",
              additions: 0,
              deletions: 0,
            },
          ];
        }

        const parsedFiles = parseDiff(diff.content, {
          nearbySequences: "zip",
        });

        return parsedFiles.map((file): ParsedFile => {
          // Calculate stats
          let additions = 0;
          let deletions = 0;
          file.hunks?.forEach(hunk => {
            additions += hunk.changes.filter(c => c.type === 'insert').length;
            deletions += hunk.changes.filter(c => c.type === 'delete').length;
          });

          return {
            fileName: diff.file,
            action: diff.action,
            repoName: diff.repoName,
            type: file.type,
            hunks: file.hunks || EMPTY_HUNKS,
            hasError: false as boolean,
            additions,
            deletions,
          };
        });
      } catch (error) {
        console.error("Failed to parse diff for file:", diff.file, error);
        return [
          {
            fileName: diff.file,
            action: diff.action,
            repoName: diff.repoName,
            type: "modify" as DiffType,
            hunks: EMPTY_HUNKS,
            hasError: true as boolean,
            errorMessage: error instanceof Error ? error.message : "Failed to parse diff",
            additions: 0,
            deletions: 0,
          },
        ];
      }
    });
  }, [allDiffs]);

  // Initialize expanded state for new files
  const prevFilesRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const prevFiles = prevFilesRef.current;
    const currentFiles = new Set(parsedFiles.map(f => f.fileName));

    // Find files that are new in this render
    const newFiles = parsedFiles.filter(f => !prevFiles.has(f.fileName));

    if (newFiles.length > 0) {
      setExpandedFiles(prev => {
        const next = new Set(prev);
        newFiles.forEach(f => next.add(f.fileName));
        return next;
      });
    }

    // Update ref for next render
    prevFilesRef.current = currentFiles;
  }, [parsedFiles]);

  const allExpanded = parsedFiles.length > 0 && expandedFiles.size === parsedFiles.length;

  const toggleFile = (fileName: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(fileName)) {
      newExpanded.delete(fileName);
    } else {
      newExpanded.add(fileName);
    }
    setExpandedFiles(newExpanded);
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(parsedFiles.map(f => f.fileName)));
    }
  };

  // Get action icon and color
  const getActionInfo = (action: Action) => {
    switch (action) {
      case "create":
        return { icon: FilePlus, color: "text-green-600 dark:text-green-400", label: "Created" };
      case "delete":
        return { icon: FileX, color: "text-red-600 dark:text-red-400", label: "Deleted" };
      case "modify":
        return { icon: FileEdit, color: "text-yellow-600 dark:text-yellow-400", label: "Modified" };
      case "rewrite":
        return { icon: FileCode, color: "text-blue-600 dark:text-blue-400", label: "Rewritten" };
      default:
        return { icon: FileEdit, color: "text-gray-600 dark:text-gray-400", label: action };
    }
  };

  // Calculate total stats
  const totalStats = useMemo(() => {
    return parsedFiles.reduce((acc, file) => ({
      files: acc.files + 1,
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }), { files: 0, additions: 0, deletions: 0 });
  }, [parsedFiles]);

  // Render empty state
  if (allDiffs.length === 0) {
    return (
      <div className={`diff-artifact-container ${isDark ? "dark-mode" : ""} ${className}`}>
        <div className="diff-artifact-empty">
          <FileCode className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>No changes to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`diff-artifact-container ${isDark ? "dark-mode" : ""} ${className} h-full flex flex-col`}>
      {/* Summary Header */}
      <div className="diff-artifact-summary p-4 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileCode className="w-5 h-5" />
            Changes
          </h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileCode className="w-4 h-4" />
              {totalStats.files} files
            </span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              +{totalStats.additions}
            </span>
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              -{totalStats.deletions}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-md p-0.5 border border-border">
            <button
              onClick={() => {
                setViewType("unified");
                localStorage.setItem("diff_view_preference", "unified");
              }}
              className={`px-2 py-1 text-xs font-medium rounded-sm transition-colors ${viewType === "unified" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Unified
            </button>
            <button
              onClick={() => {
                setViewType("split");
                localStorage.setItem("diff_view_preference", "split");
              }}
              className={`px-2 py-1 text-xs font-medium rounded-sm transition-colors ${viewType === "split" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Split
            </button>
          </div>
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md hover:bg-muted transition-colors"
          >
            {allExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {allExpanded ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {parsedFiles.map((file, index) => {
          const { icon: ActionIcon, color: actionColor, label: actionLabel } = getActionInfo(file.action);
          const isExpanded = expandedFiles.has(file.fileName);

          return (
            <div key={`${file.fileName}-${index}`} className="diff-artifact-file border border-border rounded-lg overflow-hidden bg-card">
              {/* File header */}
              <div
                className="diff-artifact-file-header flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleFile(file.fileName)}
              >
                <div className="flex items-center gap-3">
                  <button className="p-1 hover:bg-muted rounded">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className={`flex items-center gap-2 ${actionColor}`}>
                    <ActionIcon className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">{actionLabel}</span>
                  </div>
                  <span className="font-mono text-sm font-medium">{file.fileName}</span>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono">
                  {file.additions > 0 && <span className="text-green-600">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="text-red-600">-{file.deletions}</span>}
                </div>
              </div>

              {/* Content */}
              {isExpanded && (
                <div className="border-t border-border">
                  {/* Error state */}
                  {file.hasError && (
                    <div className="p-4 flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20">
                      <AlertCircle className="w-5 h-5" />
                      <span className="text-sm">{file.errorMessage || "Failed to render diff"}</span>
                    </div>
                  )}

                  {/* Diff content */}
                  {!file.hasError && file.hunks.length > 0 && (
                    <div className="overflow-x-auto">
                      <Diff viewType={viewType} diffType={file.type} hunks={file.hunks}>
                        {(hunks) =>
                          hunks.map((hunk) => (
                            <Hunk key={hunk.content} hunk={hunk} />
                          ))
                        }
                      </Diff>
                    </div>
                  )}

                  {/* Empty hunks */}
                  {!file.hasError && file.hunks.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground text-sm">
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
