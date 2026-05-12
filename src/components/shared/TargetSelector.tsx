"use client";

import React, { useMemo } from "react";
import { FolderOpen, GitBranch } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useRecentWorkflows, type RecentWorkflow } from "@/hooks/useRecentWorkflows";
import { isDevelopmentMode } from "@/lib/runtime";

export type TargetSelection =
  | { type: "repo"; repositoryId: string }
  | { type: "workflow"; workflowId: number; workflowName: string; workflowRefId: string };

interface Repository {
  id: string;
  name: string;
}

export interface TargetSelectorProps {
  /** Currently selected value: `repo:<id>` or `workflow:<id>` */
  value?: string | null;
  onChange: (selection: TargetSelection) => void;
  disabled?: boolean;
  /** Override repositories list (defaults to workspace repos) */
  repositories?: Repository[];
  /** Size variant for styling */
  size?: "sm" | "default";
  className?: string;
  placeholder?: string;
}

/** Encode a selection as a Select value string */
export function encodeTargetValue(selection: TargetSelection): string {
  if (selection.type === "repo") return `repo:${selection.repositoryId}`;
  return `workflow:${selection.workflowId}`;
}

/** Decode a Select value string back to a TargetSelection, using workflows list for lookup */
export function decodeTargetValue(
  value: string,
  workflows: RecentWorkflow[]
): TargetSelection | null {
  if (value.startsWith("repo:")) {
    const repositoryId = value.slice(5);
    return { type: "repo", repositoryId };
  }
  if (value.startsWith("workflow:")) {
    const workflowId = parseInt(value.slice(9), 10);
    if (isNaN(workflowId)) return null;
    const wf = workflows.find((w) => w.id === workflowId);
    return {
      type: "workflow",
      workflowId,
      workflowName: wf?.name ?? `Workflow ${workflowId}`,
      workflowRefId: "", // ref is not available in RecentWorkflow; caller should update separately
    };
  }
  return null;
}

/**
 * A unified target selector that lists repositories always,
 * and additionally lists Stak workflows when in the stakwork workspace or dev mode.
 *
 * Emits typed onChange payloads: `{ type: 'repo', repositoryId }` or
 * `{ type: 'workflow', workflowId, workflowName, workflowRefId }`.
 */
export function TargetSelector({
  value,
  onChange,
  disabled = false,
  repositories: repoProp,
  size = "default",
  className,
  placeholder,
}: TargetSelectorProps) {
  const { workspace } = useWorkspace();
  const isStakwork = workspace?.slug === "stakwork" || isDevelopmentMode();

  const repos = useMemo(
    () => repoProp ?? (workspace?.repositories ?? []).map((r) => ({ id: r.id, name: r.name })),
    [repoProp, workspace?.repositories]
  );

  const { workflows, isLoading: isLoadingWorkflows } = useRecentWorkflows();

  // Only fetch / show workflows in stakwork workspace
  const showWorkflows = isStakwork;

  const handleValueChange = (raw: string) => {
    if (raw.startsWith("repo:")) {
      const repositoryId = raw.slice(5);
      onChange({ type: "repo", repositoryId });
    } else if (raw.startsWith("workflow:")) {
      const workflowId = parseInt(raw.slice(9), 10);
      if (!isNaN(workflowId)) {
        const wf = workflows.find((w) => w.id === workflowId);
        onChange({
          type: "workflow",
          workflowId,
          workflowName: wf?.name ?? `Workflow ${workflowId}`,
          workflowRefId: "", // refId must be fetched separately by caller
        });
      }
    }
  };

  const triggerClass =
    size === "sm"
      ? "h-5 text-[10px] px-1.5 py-0 w-auto max-w-[140px] border-muted bg-muted/50 gap-1 [&>svg]:h-3 [&>svg]:w-3"
      : "w-[200px] h-8 text-xs rounded-lg shadow-sm";

  const selectedWorkflow =
    value?.startsWith("workflow:")
      ? workflows.find((w) => w.id === parseInt(value.slice(9), 10))
      : null;
  const selectedRepo =
    value?.startsWith("repo:") ? repos.find((r) => r.id === value.slice(5)) : null;

  return (
    <Select value={value ?? undefined} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger className={[triggerClass, className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-1.5 overflow-hidden min-w-0">
          {selectedWorkflow ? (
            <GitBranch className={size === "sm" ? "h-3 w-3 shrink-0" : "h-4 w-4 shrink-0"} />
          ) : (
            <FolderOpen className={size === "sm" ? "h-3 w-3 shrink-0" : "h-4 w-4 shrink-0"} />
          )}
          <span className="truncate min-w-0 block">
            {selectedWorkflow
              ? selectedWorkflow.name
              : selectedRepo
                ? selectedRepo.name
                : placeholder ?? "Select target"}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent>
        {repos.length > 0 && (
          <SelectGroup>
            {showWorkflows && <SelectLabel className="text-xs">Repositories</SelectLabel>}
            {repos.map((repo) => (
              <SelectItem
                key={repo.id}
                value={`repo:${repo.id}`}
                className={size === "sm" ? "text-xs" : "text-sm"}
                data-testid={`target-repo-${repo.id}`}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span>{repo.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {showWorkflows && !isLoadingWorkflows && workflows.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-xs">Stak Workflows</SelectLabel>
            {workflows.map((wf) => (
              <SelectItem
                key={wf.id}
                value={`workflow:${wf.id}`}
                className={size === "sm" ? "text-xs" : "text-sm"}
                data-testid={`target-workflow-${wf.id}`}
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span>{wf.name}</span>
                  <span className="text-muted-foreground font-mono text-xs">#{wf.id}</span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        )}

        {showWorkflows && isLoadingWorkflows && (
          <div className="px-2 py-1 text-xs text-muted-foreground">Loading workflows…</div>
        )}

        {repos.length === 0 && (!showWorkflows || workflows.length === 0) && (
          <div className="px-2 py-1 text-xs text-muted-foreground">No targets available</div>
        )}
      </SelectContent>
    </Select>
  );
}
