"use client";

import React, { useMemo, useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowNodes, type WorkflowNode } from "@/hooks/useWorkflowNodes";
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

/** Decode a Select value string back to a TargetSelection, using WorkflowNode[] for lookup */
export function decodeTargetValue(
  value: string,
  workflows: WorkflowNode[]
): TargetSelection | null {
  if (value.startsWith("repo:")) {
    const repositoryId = value.slice(5);
    return { type: "repo", repositoryId };
  }
  if (value.startsWith("workflow:")) {
    const workflowId = parseInt(value.slice(9), 10);
    if (isNaN(workflowId)) return null;
    const wf = workflows.find((w) => w.properties.workflow_id === workflowId);
    return {
      type: "workflow",
      workflowId,
      workflowName: wf?.properties.workflow_name ?? `Workflow ${workflowId}`,
      workflowRefId: wf?.ref_id ?? "",
    };
  }
  return null;
}

/**
 * A unified target selector that lists repositories always,
 * and additionally lists Stak workflows when in the stakwork workspace or dev mode.
 *
 * In stakwork/dev mode: renders a Popover + Command combobox with search.
 * Otherwise: renders a plain Select for repos only.
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
  const showWorkflows = isStakwork;

  const repos = useMemo(
    () => repoProp ?? (workspace?.repositories ?? []).map((r) => ({ id: r.id, name: r.name })),
    [repoProp, workspace?.repositories]
  );

  const { workflows, isLoading: isLoadingWorkflows } = useWorkflowNodes(
    workspace?.slug ?? null,
    showWorkflows
  );

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredWorkflows = useMemo(() => {
    if (!search.trim()) return workflows;
    const lower = search.toLowerCase();
    const numericSearch = search.trim();
    return workflows.filter((wf) => {
      const name = (wf.properties.workflow_name ?? "").toLowerCase();
      const id = String(wf.properties.workflow_id);
      return name.includes(lower) || id.startsWith(numericSearch);
    });
  }, [workflows, search]);

  const triggerClass =
    size === "sm"
      ? "h-5 text-[10px] px-1.5 py-0 w-auto max-w-[140px] border-muted bg-muted/50 gap-1 [&>svg]:h-3 [&>svg]:w-3"
      : "w-[200px] h-8 text-xs rounded-lg shadow-sm";

  // --- Combobox mode (stakwork / dev) ---
  if (showWorkflows) {
    const selectedWorkflow = value?.startsWith("workflow:")
      ? workflows.find((w) => w.properties.workflow_id === parseInt(value.slice(9), 10))
      : null;
    const selectedWorkflowId = value?.startsWith("workflow:")
      ? parseInt(value.slice(9), 10)
      : null;
    const selectedRepo = value?.startsWith("repo:")
      ? repos.find((r) => r.id === value.slice(5))
      : null;

    const label = selectedWorkflow
      ? (selectedWorkflow.properties.workflow_name ?? `Workflow ${selectedWorkflow.properties.workflow_id}`)
      : selectedWorkflowId && !selectedWorkflow
        ? `Workflow ${selectedWorkflowId}`
        : selectedRepo
          ? selectedRepo.name
          : placeholder ?? "Select target";

    const isWorkflowSelected = !!selectedWorkflow || !!selectedWorkflowId;

    return (
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setSearch("");
        }}
      >
        <PopoverTrigger asChild disabled={disabled}>
          <button
            className={[
              "inline-flex items-center border rounded text-left cursor-pointer",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              triggerClass,
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="target-selector-trigger"
          >
            <div className="flex items-center gap-1.5 overflow-hidden min-w-0">
              {isWorkflowSelected ? (
                <GitBranch className={size === "sm" ? "h-3 w-3 shrink-0" : "h-4 w-4 shrink-0"} />
              ) : (
                <FolderOpen className={size === "sm" ? "h-3 w-3 shrink-0" : "h-4 w-4 shrink-0"} />
              )}
              <span className="truncate min-w-0 block">{label}</span>
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-[260px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search workflow name or ID…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No workflows found.</CommandEmpty>

              {repos.length > 0 && (
                <CommandGroup heading="Repositories">
                  {repos.map((repo) => (
                    <CommandItem
                      key={repo.id}
                      value={`repo:${repo.id}`}
                      onSelect={() => {
                        onChange({ type: "repo", repositoryId: repo.id });
                        setOpen(false);
                        setSearch("");
                      }}
                      data-testid={`target-repo-${repo.id}`}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span>{repo.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {repos.length > 0 && filteredWorkflows.length > 0 && <CommandSeparator />}

              {isLoadingWorkflows ? (
                <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                  Loading workflows…
                </div>
              ) : (
                <CommandGroup heading="Stak Workflows">
                  {filteredWorkflows.map((wf) => (
                    <CommandItem
                      key={wf.properties.workflow_id}
                      value={`workflow:${wf.properties.workflow_id}`}
                      onSelect={() => {
                        onChange({
                          type: "workflow",
                          workflowId: wf.properties.workflow_id,
                          workflowName:
                            wf.properties.workflow_name ?? `Workflow ${wf.properties.workflow_id}`,
                          workflowRefId: wf.ref_id,
                        });
                        setOpen(false);
                        setSearch("");
                      }}
                      data-testid={`target-workflow-${wf.properties.workflow_id}`}
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 truncate">
                        {wf.properties.workflow_name ?? `Workflow ${wf.properties.workflow_id}`}
                      </span>
                      <span className="text-muted-foreground font-mono text-xs">
                        #{wf.properties.workflow_id}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  // --- Plain Select mode (non-stakwork) ---
  const selectedRepo = value?.startsWith("repo:") ? repos.find((r) => r.id === value.slice(5)) : null;

  const handleValueChange = (raw: string) => {
    if (raw.startsWith("repo:")) {
      onChange({ type: "repo", repositoryId: raw.slice(5) });
    }
  };

  return (
    <Select value={value ?? undefined} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger className={[triggerClass, className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-1.5 overflow-hidden min-w-0">
          <FolderOpen className={size === "sm" ? "h-3 w-3 shrink-0" : "h-4 w-4 shrink-0"} />
          <span className="truncate min-w-0 block">
            {selectedRepo ? selectedRepo.name : placeholder ?? "Select target"}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent>
        {repos.length > 0 && (
          <SelectGroup>
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

        {repos.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">No targets available</div>
        )}
      </SelectContent>
    </Select>
  );
}
