"use client";

import React, { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk, DiffType, HunkData, tokenize } from "react-diff-view";
import { Artifact, DiffContent, Action, ActionResult } from "@/lib/chat";
import { useTheme } from "@/hooks/use-theme";
import { getLanguageFromFile } from "@/lib/syntax-utils";
import refractor from "refractor/core.js";
import javascript from "refractor/lang/javascript.js";
import typescript from "refractor/lang/typescript.js";
import jsx from "refractor/lang/jsx.js";
import tsx from "refractor/lang/tsx.js";
import css from "refractor/lang/css.js";
import python from "refractor/lang/python.js";
import json from "refractor/lang/json.js";
import bash from "refractor/lang/bash.js";
import go from "refractor/lang/go.js";
import rust from "refractor/lang/rust.js";
import java from "refractor/lang/java.js";
import ruby from "refractor/lang/ruby.js";
import markdown from "refractor/lang/markdown.js";
import yaml from "refractor/lang/yaml.js";
import sql from "refractor/lang/sql.js";
import html from "refractor/lang/markup.js";

// Register languages with refractor
refractor.register(javascript);
refractor.register(typescript);
refractor.register(jsx);
refractor.register(tsx);
refractor.register(css);
refractor.register(python);
refractor.register(json);
refractor.register(bash);
refractor.register(go);
refractor.register(rust);
refractor.register(java);
refractor.register(ruby);
refractor.register(markdown);
refractor.register(yaml);
refractor.register(sql);
refractor.register(html);
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
  language: string;
  tokens: any;
}

const EMPTY_HUNKS: HunkData[] = [];

/**
 * Create tokens for syntax highlighting using refractor
 */
const createTokens = (hunks: HunkData[], language: string) => {
  if (!hunks || hunks.length === 0) {
    return null;
  }

  // Check if language is supported by refractor
  if (!refractor.listLanguages().includes(language)) {
    return null;
  }

  try {
    // Use react-diff-view's tokenize with refractor
    return tokenize(hunks, {
      highlight: true,
      refractor: refractor as any,
      language,
    });
  } catch (error) {
    console.error(`Failed to tokenize diff for ${language}:`, error);
    return null;
  }
};


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

  // Get diffs from the latest diff artifact (already filtered by parent)
  const allDiffs = useMemo(() => {
    // Since parent already filters to latest diff artifact, just extract diffs
    const diffArtifact = artifacts.find((artifact) => artifact.type === "DIFF");
    if (!diffArtifact) return [];

    const content = diffArtifact.content as DiffContent;
    return content?.diffs || [];
  }, [artifacts]);

  // Parse all diffs and handle errors
  const parsedFiles = useMemo<ParsedFile[]>(() => {
    return allDiffs.flatMap((diff: ActionResult): ParsedFile[] => {
      try {
        if (!diff.content || diff.content.trim() === "") {
          const language = getLanguageFromFile(diff.file);
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
              language,
              tokens: null,
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

          // Detect language and create tokens for syntax highlighting
          const language = getLanguageFromFile(diff.file);
          const hunks = file.hunks || EMPTY_HUNKS;
          const tokens = createTokens(hunks, language);

          return {
            fileName: diff.file,
            action: diff.action,
            repoName: diff.repoName,
            type: file.type,
            hunks,
            hasError: false as boolean,
            additions,
            deletions,
            language,
            tokens,
          };
        });
      } catch (error) {
        console.error("Failed to parse diff for file:", diff.file, error);
        const language = getLanguageFromFile(diff.file);
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
            language,
            tokens: null,
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
                data-testid={`file-header-${file.fileName}`}
                className="diff-artifact-file-header flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors sticky top-0 z-10 bg-card"
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
                      <Diff
                        viewType={viewType}
                        diffType={file.type}
                        hunks={file.hunks}
                        tokens={file.tokens}
                      >
                        {(hunks) => (
                          <>
                            {hunks.map((hunk, i) => {
                              // Check if there's a gap before the next hunk
                              const nextHunk = hunks[i + 1];
                              const currentEnd = hunk.oldStart + hunk.oldLines;
                              const gap = nextHunk ? nextHunk.oldStart - currentEnd : 0;
                              const showGap = gap > 5;

                              return (
                                <React.Fragment key={hunk.content}>
                                  <Hunk hunk={hunk} />
                                  {showGap && (
                                    <div className="diff-gap-indicator">
                                      <span className="diff-gap-text">
                                        ⋯ {gap} unchanged lines ⋯
                                      </span>
                                    </div>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </>
                        )}
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
