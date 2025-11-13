"use client";

import React, { useMemo } from "react";
import { parseDiff, Diff, Hunk, DiffType, HunkData } from "react-diff-view";
import { Artifact, DiffContent, Action, ActionResult } from "@/lib/chat";
import { useTheme } from "@/hooks/use-theme";
import "./DiffArtifact.css";
import { logger } from "@/lib/logger";

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
}

const EMPTY_HUNKS: HunkData[] = [];

export function DiffArtifactPanel({ artifacts, viewType = "unified", className = "" }: DiffArtifactPanelProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

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
            },
          ];
        }

        const parsedFiles = parseDiff(diff.content, {
          nearbySequences: "zip",
        });

        return parsedFiles.map((file): ParsedFile => ({
          fileName: diff.file,
          action: diff.action,
          repoName: diff.repoName,
          type: file.type,
          hunks: file.hunks || EMPTY_HUNKS,
          hasError: false as boolean,
        }));
      } catch (error) {
        logger.error("Failed to parse diff for file:", "artifacts/diff", { diff.file, error });
        return [
          {
            fileName: diff.file,
            action: diff.action,
            repoName: diff.repoName,
            type: "modify" as DiffType,
            hunks: EMPTY_HUNKS,
            hasError: true as boolean,
            errorMessage: error instanceof Error ? error.message : "Failed to parse diff",
          },
        ];
      }
    });
  }, [allDiffs]);

  // Get action badge label
  const getActionLabel = (action: Action): string => {
    const labels: Record<Action, string> = {
      create: "Created",
      modify: "Modified",
      rewrite: "Rewritten",
      delete: "Deleted",
    };
    return labels[action] || action;
  };

  // Render empty state
  if (allDiffs.length === 0) {
    return (
      <div className={`diff-artifact-container ${isDark ? "dark-mode" : ""} ${className}`}>
        <div className="diff-artifact-empty">No changes to display</div>
      </div>
    );
  }

  return (
    <div className={`diff-artifact-container ${isDark ? "dark-mode" : ""} ${className} h-full overflow-auto p-4`}>
      {parsedFiles.map((file, index) => (
        <div key={`${file.fileName}-${index}`} className="diff-artifact-file">
          {/* File header */}
          <div className="diff-artifact-file-header">
            <div className="diff-artifact-file-path">
              <span className={`diff-artifact-action-badge diff-artifact-action-${file.action}`}>{getActionLabel(file.action)}</span>
              <span>{file.fileName}</span>
            </div>
          </div>

          {/* Error state */}
          {file.hasError && <div className="diff-artifact-error">{file.errorMessage || "Failed to render diff"}</div>}

          {/* Diff content */}
          {!file.hasError && file.hunks.length > 0 && (
            <Diff viewType={viewType} diffType={file.type} hunks={file.hunks}>
              {(hunks) =>
                hunks.map((hunk) => (
                  <Hunk key={hunk.content} hunk={hunk} />
                ))
              }
            </Diff>
          )}

          {/* Empty hunks */}
          {!file.hasError && file.hunks.length === 0 && <div className="diff-artifact-empty">No changes in this file</div>}
        </div>
      ))}
    </div>
  );
}
