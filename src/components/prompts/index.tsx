"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatInUserTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Copy, Check, Plus, Minus, Pencil, Save, X, Share2, Search, History, Clock, Trash2, Zap, Upload, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { estimateTokens, formatTokenCount } from "@/lib/utils/token-estimate";
import { useDebounce } from "@/hooks/useDebounce";
import { diffLines } from "diff";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { RunEvalsModal } from "@/components/prompts/RunEvalsModal";
import { BIFROST_AGENT_NAMES } from "@/services/bifrost/agent-names";

// Sentinel ID for representing the current live version (string to avoid collisions with cuid IDs)
const CURRENT_VERSION_SENTINEL = "__CURRENT__";

// ─── AgentNamesEditor ────────────────────────────────────────────────────────

function AgentNamesEditor({
  agentNames,
  onChange,
  disabled,
}: {
  agentNames: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}) {
  const available = BIFROST_AGENT_NAMES.filter((a) => !agentNames.includes(a));

  const handleAdd = (name: string) => {
    if (!agentNames.includes(name)) {
      onChange([...agentNames, name]);
    }
  };

  const handleRemove = (name: string) => {
    onChange(agentNames.filter((n) => n !== name));
  };

  return (
    <div className="space-y-2">
      {agentNames.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No agents assigned.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {agentNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium"
            >
              {name}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(name)}
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && available.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {available.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handleAdd(name)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              <Plus className="h-3 w-3" />
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PromptUsage {
  workflow_id: number;
  workflow_name: string;
  step_id: string;
}

// Prompt list item (from API list endpoint)
interface Prompt {
  id: string;
  name: string;
  description: string;
  usage_notation: string;
  agent_names?: string[];
  value?: string;
  usages?: PromptUsage[];
}

interface PromptDetail {
  id: string;
  name: string;
  value: string;
  description: string;
  usage_notation: string;
  agent_names: string[];
  current_version_id: string | null;
  published_version_id: string | null;
  version_count: number;
}

interface PromptVersion {
  id: string;
  version_number: number;
  created_at: string;
  whodunnit: string | null;
}

interface PromptVersionDetail {
  version_id: string;
  version_number: number;
  value: string;
  created_at: string;
}

interface PromptsListResponse {
  success: boolean;
  data: {
    prompts: Prompt[];
    total: number;
    size: number;
    page: number;
  };
}

interface PromptDetailResponse {
  success: boolean;
  data: PromptDetail;
}

interface PromptsPanelProps {
  workflowId?: number;
  variant?: "panel" | "fullpage";
  onNavigateToWorkflow?: (workflowId: number) => void;
  workspaceSlug?: string;
}

type ViewMode = "list" | "detail" | "create" | "history";

type EvalResult = {
  // Rich shape from eval-set runner
  pass_rate?: number;
  passed?: number;
  failed?: number;
  total?: number;
  trigger_results?: Array<{ score?: number; result?: string; passed?: boolean }>;
  // Legacy compat for already-stored runs
  pass?: number;
  fail?: number;
};

type EvalRunState = {
  runId: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "ERROR" | "HALTED";
  result: EvalResult | null;
};

export function PromptsPanel({ workflowId, variant = "panel", onNavigateToWorkflow, workspaceSlug }: PromptsPanelProps) {
  const { timezone } = useUserTimezone();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [copiedNotation, setCopiedNotation] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedUsages, setSelectedUsages] = useState<PromptUsage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Version history state
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(null);
  const [selectedVersionAId, setSelectedVersionAId] = useState<string | null>(null);
  const [selectedVersionBId, setSelectedVersionBId] = useState<string | null>(null);
  const [versionAContent, setVersionAContent] = useState<string | null>(null);
  const [versionBContent, setVersionBContent] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [previewVersionDescription, setPreviewVersionDescription] = useState<string | null>(null);

  // Eval runs state
  const [evalRuns, setEvalRuns] = useState<Record<string, EvalRunState | null>>({});
  const [runEvalsTarget, setRunEvalsTarget] = useState<{ versionId: string; label: string } | null>(null);

  // Eval run history (per-version list of all runs, populated when >1 run exists)
  type EvalHistoryEntry = EvalRunState & { evalSetId: string | null; createdAt: string };
  const [evalRunHistory, setEvalRunHistory] = useState<Record<string, EvalHistoryEntry[]>>({});
  const [expandedHistoryKey, setExpandedHistoryKey] = useState<string | null>(null);

  // Debounced search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Form state for create/edit
  const [formName, setFormName] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAgentNames, setFormAgentNames] = useState<string[]>([]);

  // Debounced form value for live token count
  const debouncedFormValue = useDebounce(formValue, 300);
  const liveTokenCount = estimateTokens(debouncedFormValue);

  const isFullpage = variant === "fullpage";

  // Resolve workspace slug from prop or URL path
  const resolvedSlug = workspaceSlug ?? (() => {
    const parts = pathname?.split('/') ?? [];
    const wIdx = parts.indexOf('w');
    return wIdx !== -1 ? parts[wIdx + 1] : undefined;
  })();

  // Initialize search from URL on mount
  useEffect(() => {
    const searchParam = searchParams.get("search");
    if (searchParam) {
      setSearchQuery(searchParam);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when selecting a prompt (only in fullpage mode)
  // Also clears the ?version param when navigating away from a prompt
  const updateUrlWithPrompt = useCallback((promptId: string | null, versionId?: string | null) => {
    if (!isFullpage) return;

    const params = new URLSearchParams(searchParams.toString());
    if (promptId) {
      params.set("prompt", promptId);
    } else {
      params.delete("prompt");
      params.delete("version");
    }
    if (versionId != null) {
      params.set("version", versionId);
    } else {
      params.delete("version");
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [isFullpage, pathname, router, searchParams]);

  // Navigate to a specific page and update URL
  const goToPage = useCallback((n: number) => {
    setPage(n);
    if (!isFullpage) return;

    const params = new URLSearchParams(searchParams.toString());
    if (n <= 1) {
      params.delete("page");
    } else {
      params.set("page", n.toString());
    }
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [isFullpage, pathname, router, searchParams]);

  const fetchPrompts = useCallback(async (pageNum: number, searchTerm?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/workflow/prompts?page=${pageNum}&include_usages=true`;
      if (workflowId) {
        url += `&workflow_id=${workflowId}`;
      }
      // Add search parameter if provided and not empty
      const trimmedSearch = searchTerm?.trim();
      if (trimmedSearch) {
        url += `&search=${encodeURIComponent(trimmedSearch)}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch prompts");
      }
      const data: PromptsListResponse = await response.json();
      if (data.success) {
        setPrompts(data.data.prompts);
        setTotal(data.data.total);
        setPageSize(data.data.size);
      } else {
        throw new Error("Failed to fetch prompts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [workflowId]);

  const fetchPromptDetail = useCallback(async (promptId: string) => {
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`/api/workflow/prompts/${promptId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch prompt details");
      }
      const data: PromptDetailResponse = await response.json();
      if (data.success) {
        setSelectedPrompt(data.data);
        setFormValue(data.data.value);
        setFormDescription(data.data.description);
        setFormAgentNames(data.data.agent_names ?? []);
      } else {
        throw new Error("Failed to fetch prompt details");
      }
    } catch (err) {
      console.error("Error fetching prompt detail:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  const fetchVersionList = useCallback(async (promptId: string) => {
    setIsLoadingVersions(true);
    try {
      const response = await fetch(`/api/workflow/prompts/${promptId}/versions`);
      if (!response.ok) {
        throw new Error("Failed to fetch version list");
      }
      const data = await response.json();
      if (data.success && data.data.versions) {
        setVersions(data.data.versions);
      } else {
        throw new Error("Failed to fetch version list");
      }
    } catch (err) {
      console.error("Error fetching version list:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch version list");
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  const fetchVersionContent = useCallback(async (promptId: string, versionId: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workflow/prompts/${promptId}/versions/${versionId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch version content");
      }
      const data = await response.json();
      if (data.success && data.data.value !== undefined) {
        return data.data.value;
      } else {
        throw new Error("Failed to fetch version content");
      }
    } catch (err) {
      console.error("Error fetching version content:", err);
      return null;
    }
  }, []);

  const fetchVersionDetail = useCallback(async (promptId: string, versionId: string): Promise<{ value: string; description: string } | null> => {
    try {
      const response = await fetch(`/api/workflow/prompts/${promptId}/versions/${versionId}`);
      if (!response.ok) throw new Error("Failed to fetch version detail");
      const data = await response.json();
      if (data.success) return { value: data.data.value as string, description: data.data.description as string };
      return null;
    } catch (err) {
      console.error("Error fetching version detail:", err);
      return null;
    }
  }, []);

  // Load persisted eval runs when entering history view
  useEffect(() => {
    if (viewMode !== 'history' || !selectedPrompt || !resolvedSlug) return;

    const versionIds: string[] = versions.map((v) => v.id);
    if (selectedPrompt.current_version_id) {
      versionIds.push(selectedPrompt.current_version_id);
    }

    if (versionIds.length === 0) return;

    const fetchRuns = async () => {
      const results = await Promise.all(
        versionIds.map(async (vId) => {
          try {
            const res = await fetch(
              `/api/workspaces/${resolvedSlug}/prompts/${selectedPrompt.id}/versions/${vId}/run-evals`
            );
            if (!res.ok) return null;
            const data = await res.json();
            return data.success ? { vId, run: data.data ?? null, history: data.history ?? [] } : null;
          } catch {
            return null;
          }
        })
      );

      setEvalRuns((prev) => {
        const next = { ...prev };
        results.forEach((item) => {
          if (!item || !item.run) return;
          const { vId, run } = item;
          // Key Current row under CURRENT_VERSION_SENTINEL
          const key = vId === selectedPrompt.current_version_id ? CURRENT_VERSION_SENTINEL : vId;
          next[key] = {
            runId: run.id ?? '',
            status: run.status,
            result: run.result ? (typeof run.result === 'string' ? JSON.parse(run.result) : run.result) : null,
          };
        });
        return next;
      });

      setEvalRunHistory((prev) => {
        const next = { ...prev };
        results.forEach((item) => {
          if (!item || item.history.length < 2) return;
          const key = item.vId === selectedPrompt.current_version_id ? CURRENT_VERSION_SENTINEL : item.vId;
          next[key] = item.history.map((h: { id: string; status: string; result: string | null; evalSetId: string | null; createdAt: string }) => ({
            runId: h.id,
            status: h.status as EvalRunState['status'],
            result: h.result ? (typeof h.result === 'string' ? JSON.parse(h.result) : h.result) : null,
            evalSetId: h.evalSetId,
            createdAt: h.createdAt,
          }));
        });
        return next;
      });
    };

    fetchRuns();
  }, [viewMode, selectedPrompt, versions, resolvedSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pusher subscription for real-time eval results in history view
  useEffect(() => {
    if (viewMode !== 'history' || !resolvedSlug) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>['subscribe']> | null = null;
    try {
      const pusher = getPusherClient();
      channel = pusher.subscribe(getWorkspaceChannelName(resolvedSlug));
      channel.bind(
        PUSHER_EVENTS.PROMPT_EVAL_RESULT,
        (data: { runId: string; promptVersionId: string; result: EvalResult }) => {
          const key =
            selectedPrompt && data.promptVersionId === selectedPrompt.current_version_id
              ? CURRENT_VERSION_SENTINEL
              : data.promptVersionId;
          setEvalRuns((prev) => ({
            ...prev,
            [key]: {
              runId: data.runId,
              status: 'COMPLETED',
              result: data.result,
            },
          }));
        }
      );
    } catch {
      // Pusher not configured — no-op
    }

    return () => {
      channel?.unbind(PUSHER_EVENTS.PROMPT_EVAL_RESULT);
    };
  }, [viewMode, resolvedSlug, selectedPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch prompts when page or search changes
  useEffect(() => {
    fetchPrompts(page, debouncedSearchQuery);
  }, [page, debouncedSearchQuery, fetchPrompts]);

  // Check for prompt ID (and optional version) in URL on mount (only in fullpage mode)
  useEffect(() => {
    if (!isFullpage) return;

    const promptId = searchParams.get("prompt");
    const versionId = searchParams.get("version");
    if (promptId) {
      setViewMode("detail");
      fetchPromptDetail(promptId).then(() => {
        if (versionId) {
          fetchVersionList(promptId).then(() => {
            setViewMode("history");
            setSelectedVersionAId(versionId);
            fetchVersionContent(promptId, versionId).then((content) => {
              if (content !== null) {
                setVersionAContent(content);
              }
            });
          });
        }
      });
    }
  }, [isFullpage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    // Page reset happens in the debounced effect below — no per-keystroke navigation
  };

  // Update URL when debounced search changes and reset page to 1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentSearch = params.get("search") || "";
    const trimmedQuery = debouncedSearchQuery.trim();

    // Only update if the value actually changed
    if (currentSearch !== trimmedQuery) {
      // Reset page state alongside the URL update so they land in the same batch
      setPage(1);
      if (trimmedQuery) {
        params.set("search", trimmedQuery);
      } else {
        params.delete("search");
      }
      params.delete("page"); // Remove page param when searching
      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(newUrl, { scroll: false });
    }
  }, [debouncedSearchQuery, pathname, router]);

  const handlePromptClick = (prompt: Prompt) => {
    setViewMode("detail");
    setIsEditing(false);
    setSelectedUsages(prompt.usages || []);
    fetchPromptDetail(prompt.id);
    updateUrlWithPrompt(prompt.id);
  };

  const handleBackToList = () => {
    setSelectedPrompt(null);
    setViewMode("list");
    setIsEditing(false);
    setCopiedNotation(false);
    setSelectedUsages([]);
    setFormName("");
    setFormValue("");
    setFormDescription("");
    setFormAgentNames([]);
    updateUrlWithPrompt(null);
  };

  const handleCreateClick = () => {
    setViewMode("create");
    setFormName("");
    setFormValue("");
    setFormDescription("");
    setFormAgentNames([]);
  };

  const handleEditClick = () => {
    if (selectedPrompt) {
      setFormValue(selectedPrompt.value);
      setFormDescription(selectedPrompt.description);
      setFormAgentNames(selectedPrompt.agent_names ?? []);
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (selectedPrompt) {
      setFormValue(selectedPrompt.value);
      setFormDescription(selectedPrompt.description);
      setFormAgentNames(selectedPrompt.agent_names ?? []);
    }
    setIsEditing(false);
  };

  const handleOpenWorkflowInNewTab = useCallback((targetWorkflowId: number) => {
    if (workspaceSlug) {
      // Store the workflow ID to prefill in the new tab
      localStorage.setItem("prefill_workflow_id", targetWorkflowId.toString());
      localStorage.setItem("task_mode", "workflow_editor");
      window.open(`/w/${workspaceSlug}/task/new`, "_blank");
    } else if (onNavigateToWorkflow) {
      onNavigateToWorkflow(targetWorkflowId);
    }
  }, [workspaceSlug, onNavigateToWorkflow]);

  const handleCreatePrompt = async () => {
    if (!formName.trim() || !formValue.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/workflow/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          value: formValue.trim(),
          description: formDescription.trim(),
          agentNames: formAgentNames,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create prompt");
      }

      const data = await response.json();
      if (data.success) {
        // Reset form and go back to list
        handleBackToList();
        // Refresh the list to show the new prompt
        fetchPrompts(1);
        goToPage(1);
      } else {
        throw new Error("Failed to create prompt");
      }
    } catch (err) {
      console.error("Error creating prompt:", err);
      setError(err instanceof Error ? err.message : "Failed to create prompt");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!selectedPrompt || !formValue.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/workflow/prompts/${selectedPrompt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: formValue.trim(),
          description: formDescription.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update prompt");
      }

      const data = await response.json();
      if (data.success) {
        // Refresh the prompt detail
        await fetchPromptDetail(selectedPrompt.id);
        setIsEditing(false);
        // Also refresh the list in case description changed
        fetchPrompts(page);
      } else {
        throw new Error("Failed to update prompt");
      }
    } catch (err) {
      console.error("Error updating prompt:", err);
      setError(err instanceof Error ? err.message : "Failed to update prompt");
    } finally {
      setIsSaving(false);
    }
  };

  // Agent names are Prompt-level metadata (not versioned) and are saved
  // independently of the draft/publish lifecycle. Autosave via PATCH.
  const [isSavingAgentNames, setIsSavingAgentNames] = useState(false);

  const handleSaveAgentNames = async (names: string[]) => {
    if (!selectedPrompt) return;

    const previous = selectedPrompt.agent_names ?? [];
    // Optimistic update
    setFormAgentNames(names);
    setSelectedPrompt({ ...selectedPrompt, agent_names: names });
    setIsSavingAgentNames(true);
    try {
      const response = await fetch(`/api/workflow/prompts/${selectedPrompt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentNames: names }),
      });
      if (!response.ok) {
        throw new Error("Failed to update agent names");
      }
    } catch (err) {
      console.error("Error updating agent names:", err);
      // Revert on failure
      setFormAgentNames(previous);
      setSelectedPrompt((prev) => (prev ? { ...prev, agent_names: previous } : prev));
      setError(err instanceof Error ? err.message : "Failed to update agent names");
    } finally {
      setIsSavingAgentNames(false);
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedPrompt) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflow/prompts/${selectedPrompt.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete prompt");
      }

      const data = await response.json();
      if (data.success) {
        // Navigate back to list and refresh
        handleBackToList();
        fetchPrompts(1);
      } else {
        throw new Error("Failed to delete prompt");
      }
    } catch (err) {
      console.error("Error deleting prompt:", err);
      setError(err instanceof Error ? err.message : "Failed to delete prompt");
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const handleCopyNotation = async () => {
    if (selectedPrompt?.usage_notation) {
      await navigator.clipboard.writeText(selectedPrompt.usage_notation);
      setCopiedNotation(true);
      setTimeout(() => setCopiedNotation(false), 2000);
    }
  };

  const handleSharePrompt = async (promptId: string) => {
    // Extract workspace slug from pathname (format: /w/[slug]/...)
    const pathParts = pathname.split("/");
    const wIndex = pathParts.indexOf("w");
    const slug = wIndex !== -1 && pathParts[wIndex + 1] ? pathParts[wIndex + 1] : workspaceSlug;

    if (!slug) return;

    // Generate the share URL - always points to prompts mode with the prompt selected
    const baseUrl = window.location.origin;
    const shareUrl = `${baseUrl}/w/${slug}/task/new?prompt=${promptId}`;

    await navigator.clipboard.writeText(shareUrl);
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2000);
  };

  const handleHistoryClick = async () => {
    if (!selectedPrompt) return;
    
    setViewMode("history");
    await fetchVersionList(selectedPrompt.id);
  };

  const handleBackToDetail = () => {
    setViewMode("detail");
    setVersions([]);
    setSelectedVersionAId(null);
    setSelectedVersionBId(null);
    setVersionAContent(null);
    setVersionBContent(null);
    setPreviewVersionDescription(null);
  };

  const handleEditFromVersion = () => {
    if (!selectedVersionAId || versionAContent === null) return;
    setFormValue(versionAContent);
    setFormDescription(previewVersionDescription ?? selectedPrompt!.description);
    // Reset all history state
    setVersions([]);
    setSelectedVersionAId(null);
    setSelectedVersionBId(null);
    setVersionAContent(null);
    setVersionBContent(null);
    setPreviewVersionDescription(null);
    setViewMode("detail");
    setIsEditing(true);
  };

  const handlePublishVersion = async (versionId: string) => {
    if (!selectedPrompt) return;
    setIsPublishing(true);
    setPublishingVersionId(versionId);
    setError(null);
    try {
      const response = await fetch(
        `/api/workflow/prompts/${selectedPrompt.id}/versions/${versionId}/publish`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Failed to publish version");
      const data = await response.json();
      if (!data.success) throw new Error("Failed to publish version");
      await fetchPromptDetail(selectedPrompt.id);
      setViewMode("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish version");
    } finally {
      setIsPublishing(false);
      setPublishingVersionId(null);
    }
  };

  const handleVersionClick = (versionId: string) => {
    if (selectedVersionAId === null) {
      setSelectedVersionAId(versionId);
    } else if (selectedVersionBId === null) {
      if (versionId === selectedVersionAId) {
        // Clicking the same version twice deselects it
        setSelectedVersionAId(null);
      } else {
        setSelectedVersionBId(versionId);
      }
    } else {
      // Both selected, replace B with new selection
      if (versionId === selectedVersionAId) {
        // Deselect A, move B to A
        setSelectedVersionAId(selectedVersionBId);
        setSelectedVersionBId(null);
      } else if (versionId === selectedVersionBId) {
        // Deselect B
        setSelectedVersionBId(null);
      } else {
        // Replace B with new selection
        setSelectedVersionBId(versionId);
      }
    }
  };

  // Fetch version content when A (and optionally B) is selected
  useEffect(() => {
    if (!selectedPrompt || !selectedVersionAId) {
      setVersionAContent(null);
      setVersionBContent(null);
      setPreviewVersionDescription(null);
      return;
    }

    const fetchContent = async () => {
      setIsLoadingDiff(true);
      try {
        if (selectedVersionBId) {
          // Both A and B selected: fetch for diff
          const resolveA = selectedVersionAId === CURRENT_VERSION_SENTINEL
            ? Promise.resolve({ value: selectedPrompt.value, description: selectedPrompt.description })
            : fetchVersionDetail(selectedPrompt.id, selectedVersionAId);

          const resolveB = selectedVersionBId === CURRENT_VERSION_SENTINEL
            ? Promise.resolve(selectedPrompt.value)
            : fetchVersionContent(selectedPrompt.id, selectedVersionBId);

          const [detailA, contentB] = await Promise.all([resolveA, resolveB]);
          setVersionAContent(detailA ? detailA.value : null);
          setPreviewVersionDescription(detailA ? detailA.description : null);
          setVersionBContent(contentB);
        } else {
          // Only A selected: preview mode
          if (selectedVersionAId === CURRENT_VERSION_SENTINEL) {
            setVersionAContent(selectedPrompt.value);
            setPreviewVersionDescription(selectedPrompt.description);
          } else {
            const detail = await fetchVersionDetail(selectedPrompt.id, selectedVersionAId);
            setVersionAContent(detail ? detail.value : null);
            setPreviewVersionDescription(detail ? detail.description : null);
          }
          setVersionBContent(null);
        }
      } catch (err) {
        console.error("Error fetching version content:", err);
      } finally {
        setIsLoadingDiff(false);
      }
    };

    fetchContent();
  }, [selectedPrompt, selectedVersionAId, selectedVersionBId, fetchVersionContent, fetchVersionDetail]);

  const formatTimestamp = (timestamp: string) => {
    try {
      return formatInUserTz(new Date(timestamp), timezone);
    } catch {
      return timestamp;
    }
  };

  // Common wrapper classes for fullpage mode
  const wrapperClassName = isFullpage
    ? "w-full bg-card rounded-3xl shadow-sm border flex-1 overflow-hidden flex flex-col min-h-0"
    : "";

  if (isLoading && prompts.length === 0 && viewMode === "list") {
    const content = (
      <div className={cn("flex items-center justify-center p-8", isFullpage ? "h-[400px]" : "h-full")}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground text-sm">Loading prompts...</span>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  if (error && prompts.length === 0 && viewMode === "list") {
    const content = (
      <div className={cn("flex items-center justify-center p-8", isFullpage ? "h-[400px]" : "h-full")}>
        <div className="text-destructive text-sm">{error}</div>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Create prompt view
  if (viewMode === "create") {
    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium flex-1">Create New Prompt</span>
        </div>

        <div className="flex-1 overflow-auto min-h-0 p-4">
          <div className={cn("space-y-4", isFullpage && "max-w-3xl mx-auto")}>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="PROMPT_NAME"
                value={formName}
                onChange={(e) => setFormName(e.target.value.toUpperCase().replace(/[^A-Z_]/g, ""))}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Only uppercase letters (A–Z) and underscores (_) are allowed.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Description
              </label>
              <Input
                className="mt-1"
                placeholder="Optional description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                disabled={isSaving}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Agent Names
              </label>
              <div className="mt-1">
                <AgentNamesEditor
                  agentNames={formAgentNames}
                  onChange={setFormAgentNames}
                  disabled={isSaving}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Value <span className="text-destructive">*</span>
              </label>
              <Textarea
                className={cn("mt-1 font-mono text-sm", isFullpage ? "min-h-[500px]" : "min-h-[200px]")}
                placeholder="Enter prompt value..."
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground text-right mt-1">{formatTokenCount(liveTokenCount)}</p>
            </div>

          </div>
        </div>
        <div className="flex justify-end gap-2 p-3 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleBackToList} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleCreatePrompt}
            disabled={isSaving || !formName.trim() || !formValue.trim()}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Prompt
              </>
            )}
          </Button>
        </div>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Show prompt detail view
  if (viewMode === "detail" && selectedPrompt) {
    const isPublished = selectedPrompt.current_version_id !== null &&
      selectedPrompt.current_version_id === selectedPrompt.published_version_id;

    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium truncate flex-1">{selectedPrompt.name}</span>
          {!isEditing && (
            isPublished ? (
              <Badge variant="default" className="bg-green-600 text-white text-xs flex-shrink-0">Published</Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-600 text-xs flex-shrink-0">Unpublished</Badge>
            )
          )}
          {!isEditing && (
            <>
              {!isPublished && selectedPrompt.current_version_id && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPublishing}
                    >
                      {isPublishing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          Publishing...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-1" />
                          Publish
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Publish Changes?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will make the current version the live prompt used by all workflows. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handlePublishVersion(selectedPrompt.current_version_id!)}>
                        Publish
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSharePrompt(selectedPrompt.id)}
                title="Copy share link"
              >
                {copiedShareLink ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={handleEditClick}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={isDeleting}
                  >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Prompt</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete &quot;{selectedPrompt.name}&quot;? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeletePrompt}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={isDeleting}
                    >
                      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>

        {isLoadingDetail ? (
          <div className="flex items-center justify-center flex-1 p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto min-h-0 p-4">
            <div className={cn("space-y-4", isFullpage && "max-w-3xl mx-auto")}>
              {!isEditing && selectedPrompt.version_count > 1 && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleHistoryClick}
                    className="w-full"
                  >
                    <History className="h-4 w-4 mr-2" />
                    View History ({selectedPrompt.version_count} versions)
                  </Button>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Usage Notation
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-1 rounded font-mono flex-1 overflow-x-auto">
                    {selectedPrompt.usage_notation}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyNotation}
                    className="flex-shrink-0"
                  >
                    {copiedNotation ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </label>
                {isEditing ? (
                  <Input
                    className="mt-1"
                    placeholder="Optional description"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    disabled={isSaving}
                  />
                ) : (
                  <p className="mt-1 text-sm">
                    {selectedPrompt.description || <span className="text-muted-foreground italic">No description</span>}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Agent Names
                </label>
                {/* Agent names are Prompt-level metadata — edited inline and saved
                    immediately, independent of the draft/publish lifecycle. */}
                <div className="mt-1">
                  <AgentNamesEditor
                    agentNames={selectedPrompt.agent_names ?? []}
                    onChange={handleSaveAgentNames}
                    disabled={isSavingAgentNames}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Prompt Value
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {formatTokenCount(estimateTokens(isEditing ? debouncedFormValue : selectedPrompt.value))}
                  </span>
                </div>
                {isEditing ? (
                  <>
                    <Textarea
                      className={cn("mt-1 font-mono text-sm", isFullpage ? "min-h-[500px]" : "min-h-[200px]")}
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                      disabled={isSaving}
                    />
                    <p className="text-xs text-muted-foreground text-right mt-1">{formatTokenCount(liveTokenCount)}</p>
                  </>
                ) : (
                  <pre className={cn(
                    "mt-1 text-sm bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono",
                  )}>
                    {selectedPrompt.value}
                  </pre>
                )}
              </div>



              {!isEditing && selectedUsages.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Used In ({selectedUsages.length} {selectedUsages.length === 1 ? "place" : "places"})
                  </label>
                  <div className="mt-2 space-y-2">
                    {selectedUsages.map((usage, index) =>
                      workspaceSlug || onNavigateToWorkflow ? (
                        <button
                          key={`${usage.workflow_id}-${usage.step_id}-${index}`}
                          onClick={() => handleOpenWorkflowInNewTab(usage.workflow_id)}
                          className="w-full text-left text-sm bg-muted/50 border rounded p-2 hover:bg-muted transition-colors cursor-pointer"
                        >
                          <div className="font-medium truncate">{usage.workflow_name}</div>
                          <div className="text-xs text-muted-foreground flex gap-2 mt-1">
                            <span>Workflow ID: {usage.workflow_id}</span>
                            <span>|</span>
                            <span>Step: {usage.step_id}</span>
                          </div>
                        </button>
                      ) : (
                        <div
                          key={`${usage.workflow_id}-${usage.step_id}-${index}`}
                          className="text-sm bg-muted/50 border rounded p-2"
                        >
                          <div className="font-medium truncate">{usage.workflow_name}</div>
                          <div className="text-xs text-muted-foreground flex gap-2 mt-1">
                            <span>Workflow ID: {usage.workflow_id}</span>
                            <span>|</span>
                            <span>Step: {usage.step_id}</span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
        {isEditing && (
          <div className="flex justify-end gap-2 p-3 border-t flex-shrink-0">
            <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              onClick={handleUpdatePrompt}
              disabled={isSaving || !formValue.trim()}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Show version history view
  if (viewMode === "history" && selectedPrompt) {
    interface DiffPart {
      added?: boolean;
      removed?: boolean;
      value: string;
    }

    let diffChanges: DiffPart[] = [];
    let stats = { additions: 0, deletions: 0 };

    if (versionAContent && versionBContent) {
      diffChanges = diffLines(versionBContent, versionAContent);
      stats = diffChanges.reduce(
        (acc, part) => {
          const lines = part.value.split('\n').filter(line => line !== '');
          if (part.added) {
            acc.additions += lines.length;
          } else if (part.removed) {
            acc.deletions += lines.length;
          }
          return acc;
        },
        { additions: 0, deletions: 0 }
      );
    }

    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToDetail}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium truncate flex-1">Version History - {selectedPrompt.name}</span>
        </div>

        {isLoadingVersions ? (
          <div className="flex items-center justify-center flex-1 p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground text-sm">Loading versions...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Version List */}
            <div className="border-b bg-muted/30 p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Click a version to preview · Select two to compare
              </div>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {/* Current Version Button */}
                {(() => {
                  const isCurrentA = selectedVersionAId === CURRENT_VERSION_SENTINEL;
                  const isCurrentB = selectedVersionBId === CURRENT_VERSION_SENTINEL;
                  const isCurrentSelected = isCurrentA || isCurrentB;

                  return (
                    <div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleVersionClick(CURRENT_VERSION_SENTINEL)}
                          className={cn(
                            "flex-1 text-left px-3 py-2 rounded transition-colors text-sm",
                            "hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-primary",
                            isCurrentA && "bg-green-100 dark:bg-green-900/50 ring-2 ring-green-500",
                            isCurrentB && "bg-red-100 dark:bg-red-900/50 ring-2 ring-red-500",
                            !isCurrentSelected && "bg-muted/50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Zap className="w-3 h-3" />
                              <span className="font-mono font-medium">Current</span>
                              {isCurrentA && <span className="text-xs text-green-600 dark:text-green-400 font-medium">A</span>}
                              {isCurrentB && <span className="text-xs text-red-600 dark:text-red-400 font-medium">B</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {selectedPrompt.published_version_id !== null &&
                                selectedPrompt.current_version_id === selectedPrompt.published_version_id && (
                                  <Badge variant="default" className="text-xs flex-shrink-0 bg-green-600 text-white">
                                    Published
                                  </Badge>
                                )}
                              <span className="text-xs text-muted-foreground">Latest</span>
                              {evalRuns[CURRENT_VERSION_SENTINEL]?.status === 'IN_PROGRESS' ? (
                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                              ) : evalRuns[CURRENT_VERSION_SENTINEL]?.status === 'COMPLETED' && evalRuns[CURRENT_VERSION_SENTINEL]?.result ? (
                                <Badge
                                  variant="default"
                                  className={cn(
                                    "text-xs flex-shrink-0",
                                    (evalRuns[CURRENT_VERSION_SENTINEL]!.result!.failed ?? evalRuns[CURRENT_VERSION_SENTINEL]!.result!.fail ?? 0) === 0
                                      ? "bg-green-600 text-white"
                                      : "bg-red-600 text-white"
                                  )}
                                  title="Eval result"
                                >
                                  {evalRuns[CURRENT_VERSION_SENTINEL]!.result!.passed ?? evalRuns[CURRENT_VERSION_SENTINEL]!.result!.pass}/{evalRuns[CURRENT_VERSION_SENTINEL]!.result!.total} pass
                                </Badge>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="flex-shrink-0 h-7 px-2"
                                  disabled={!resolvedSlug}
                                  title="Run evals on Current"
                                  onClick={(e) => { e.stopPropagation(); setRunEvalsTarget({ versionId: CURRENT_VERSION_SENTINEL, label: 'Current' }); }}
                                >
                                  <Play className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </button>
                        {evalRunHistory[CURRENT_VERSION_SENTINEL]?.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-shrink-0 h-7 w-7 p-0"
                            title="Toggle eval run history"
                            onClick={(e) => { e.stopPropagation(); setExpandedHistoryKey(expandedHistoryKey === CURRENT_VERSION_SENTINEL ? null : CURRENT_VERSION_SENTINEL); }}
                          >
                            {expandedHistoryKey === CURRENT_VERSION_SENTINEL
                              ? <ChevronDown className="h-3 w-3" />
                              : <ChevronRight className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                      {expandedHistoryKey === CURRENT_VERSION_SENTINEL && evalRunHistory[CURRENT_VERSION_SENTINEL]?.map((entry) => (
                        <div key={entry.runId} className="ml-8 flex items-center gap-2 py-1 text-xs text-muted-foreground border-l border-border pl-3">
                          <span>{new Date(entry.createdAt).toLocaleString()}</span>
                          {entry.evalSetId && <span className="font-mono">{entry.evalSetId}</span>}
                          {entry.status === 'COMPLETED' && entry.result && (
                            <Badge
                              variant="default"
                              className={cn(
                                "text-xs",
                                (entry.result.failed ?? entry.result.fail ?? 0) === 0 ? "bg-green-600 text-white" : "bg-red-600 text-white"
                              )}
                            >
                              {entry.result.passed ?? entry.result.pass}/{entry.result.total} pass
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Historical Versions */}
                {versions.length > 0 ? (
                  versions.map((version) => {
                    const isSelectedA = selectedVersionAId === version.id;
                    const isSelectedB = selectedVersionBId === version.id;
                    const isSelected = isSelectedA || isSelectedB;
                    const isLive = version.id === selectedPrompt.published_version_id &&
                                  version.id !== selectedPrompt.current_version_id;

                    return (
                      <div key={version.id}>
                        <div className="relative flex items-center gap-2">
                          <button
                            onClick={() => handleVersionClick(version.id)}
                            className={cn(
                              "flex-1 text-left px-3 py-2 rounded transition-colors text-sm",
                              "hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-primary",
                              isSelectedA && "bg-green-100 dark:bg-green-900/50 ring-2 ring-green-500",
                              isSelectedB && "bg-red-100 dark:bg-red-900/50 ring-2 ring-red-500",
                              !isSelected && "bg-muted/50"
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-medium">v{version.version_number}</span>
                                {isSelectedA && <span className="text-xs text-green-600 dark:text-green-400 font-medium">A</span>}
                                {isSelectedB && <span className="text-xs text-red-600 dark:text-red-400 font-medium">B</span>}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {formatTimestamp(version.created_at)}
                              </span>
                            </div>
                          </button>

                          {/* Eval run button / spinner / badge */}
                          {evalRuns[version.id]?.status === 'IN_PROGRESS' ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                          ) : evalRuns[version.id]?.status === 'COMPLETED' && evalRuns[version.id]?.result ? (
                            <Badge
                              variant="default"
                              className={cn(
                                "text-xs flex-shrink-0",
                                (evalRuns[version.id]!.result!.failed ?? evalRuns[version.id]!.result!.fail ?? 0) === 0
                                  ? "bg-green-600 text-white"
                                  : "bg-red-600 text-white"
                              )}
                              title="Eval result"
                            >
                              {evalRuns[version.id]!.result!.passed ?? evalRuns[version.id]!.result!.pass}/{evalRuns[version.id]!.result!.total} pass
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-shrink-0 h-7 px-2"
                              disabled={!resolvedSlug}
                              title={`Run evals on v${version.version_number}`}
                              onClick={(e) => { e.stopPropagation(); setRunEvalsTarget({ versionId: version.id, label: `v${version.version_number}` }); }}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                          {/* History toggle */}
                          {evalRunHistory[version.id]?.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-shrink-0 h-7 w-7 p-0"
                              title="Toggle eval run history"
                              onClick={(e) => { e.stopPropagation(); setExpandedHistoryKey(expandedHistoryKey === version.id ? null : version.id); }}
                            >
                              {expandedHistoryKey === version.id
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />}
                            </Button>
                          )}
                          {/* Publish button */}
                          {isLive ? (
                            <Badge variant="default" className="text-xs flex-shrink-0 bg-green-600 text-white">Published</Badge>
                          ) : publishingVersionId === version.id ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                          ) : (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex-shrink-0 h-7 w-7 p-0"
                                    disabled={isPublishing}
                                    title={`Publish v${version.version_number}`}
                                  >
                                    <Upload className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Publish Version v{version.version_number}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will make v{version.version_number} the live prompt used by all workflows. This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handlePublishVersion(version.id)}>
                                      Publish
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                          )}
                        </div>
                        {/* Expandable eval run history */}
                        {expandedHistoryKey === version.id && evalRunHistory[version.id]?.map((entry) => (
                          <div key={entry.runId} className="ml-8 flex items-center gap-2 py-1 text-xs text-muted-foreground border-l border-border pl-3">
                            <span>{new Date(entry.createdAt).toLocaleString()}</span>
                            {entry.evalSetId && <span className="font-mono">{entry.evalSetId}</span>}
                            {entry.status === 'COMPLETED' && entry.result && (
                              <Badge
                                variant="default"
                                className={cn(
                                  "text-xs",
                                  (entry.result.failed ?? entry.result.fail ?? 0) === 0 ? "bg-green-600 text-white" : "bg-red-600 text-white"
                                )}
                              >
                                {entry.result.passed ?? entry.result.pass}/{entry.result.total} pass
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-4">
                    <div className="text-xs text-muted-foreground">No previous versions</div>
                  </div>
                )}
              </div>
            </div>

            {/* Preview Panel (single version selected) */}
            {selectedVersionAId && !selectedVersionBId && (
              <div className="flex-1 overflow-hidden flex flex-col">
                {isLoadingDiff ? (
                  <div className="flex items-center justify-center flex-1 p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground text-sm">Loading preview...</span>
                  </div>
                ) : versionAContent !== null ? (
                  <>
                    <div className="flex items-center justify-between p-3 border-b bg-muted/30 flex-shrink-0">
                      <span className="text-xs font-medium">
                        {selectedVersionAId === CURRENT_VERSION_SENTINEL ? "Current" : (() => {
                          const v = versions.find(v => v.id === selectedVersionAId);
                          return v ? `v${v.version_number}` : "Version";
                        })()}
                      </span>
                      {selectedVersionAId !== CURRENT_VERSION_SENTINEL && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleEditFromVersion}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Edit from this version
                        </Button>
                      )}
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words">{versionAContent}</pre>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center flex-1 p-8">
                    <div className="text-muted-foreground text-sm">Failed to load version content</div>
                  </div>
                )}
              </div>
            )}

            {/* Diff View */}
            {selectedVersionAId && selectedVersionBId && (
              <div className="flex-1 overflow-hidden flex flex-col">
                {isLoadingDiff ? (
                  <div className="flex items-center justify-center flex-1 p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground text-sm">Loading diff...</span>
                  </div>
                ) : versionAContent && versionBContent ? (
                  <>
                    <div className="flex items-center justify-between p-3 border-b bg-muted/30 flex-shrink-0">
                      <span className="text-xs font-medium">Changes</span>
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
                    <div className="flex-1 overflow-auto font-mono text-xs">
                      <table className="w-full border-collapse">
                        <tbody>
                          {diffChanges.map((part: DiffPart, index: number) => {
                            const lines = part.value.split('\n');
                            if (lines[lines.length - 1] === '') {
                              lines.pop();
                            }

                            return lines.map((line: string, lineIndex: number) => {
                              let bgColor = "";
                              let textColor = "";
                              let prefix = " ";
                              let Icon: typeof Plus | typeof Minus | null = null;

                              if (part.added) {
                                bgColor = "bg-green-50 dark:bg-green-950/50";
                                textColor = "text-green-800 dark:text-green-300";
                                prefix = "+";
                                Icon = Plus;
                              } else if (part.removed) {
                                bgColor = "bg-red-50 dark:bg-red-950/50";
                                textColor = "text-red-800 dark:text-red-300";
                                prefix = "-";
                                Icon = Minus;
                              }

                              return (
                                <tr key={`${index}-${lineIndex}`} className={bgColor}>
                                  <td className={cn(
                                    "w-8 px-2 py-0.5 text-right select-none border-r border-border/50",
                                    textColor || "text-muted-foreground"
                                  )}>
                                    {Icon && <Icon className="w-3 h-3 inline" />}
                                    {!Icon && <span className="opacity-30">{prefix}</span>}
                                  </td>
                                  <td className={cn("px-3 py-0.5 whitespace-pre", textColor)}>
                                    {line || " "}
                                  </td>
                                </tr>
                              );
                            });
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center flex-1 p-8">
                    <div className="text-muted-foreground text-sm">Failed to load version content</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );

    const historyView = (
      <>
        {isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content}
        {runEvalsTarget && resolvedSlug && (
          <RunEvalsModal
            open={!!runEvalsTarget}
            onClose={() => setRunEvalsTarget(null)}
            versionLabel={runEvalsTarget.label}
            workspaceSlug={resolvedSlug}
            onConfirm={async (evalSetId) => {
              if (!selectedPrompt || !resolvedSlug) return;
              const capturedTarget = runEvalsTarget;
              const vId =
                capturedTarget.versionId === CURRENT_VERSION_SENTINEL
                  ? selectedPrompt.current_version_id!
                  : capturedTarget.versionId;
              setRunEvalsTarget(null);
              setEvalRuns((prev) => ({
                ...prev,
                [capturedTarget.versionId]: { runId: '', status: 'IN_PROGRESS', result: null },
              }));
              try {
                const res = await fetch(
                  `/api/workspaces/${resolvedSlug}/prompts/${selectedPrompt.id}/versions/${vId}/run-evals`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ evalSetId, promptName: selectedPrompt.name }),
                  }
                );
                if (!res.ok) throw new Error('Failed to start eval run');
                const data = await res.json();
                setEvalRuns((prev) => ({
                  ...prev,
                  [capturedTarget.versionId]: { runId: data.runId, status: 'IN_PROGRESS', result: null },
                }));
              } catch {
                setEvalRuns((prev) => ({ ...prev, [capturedTarget.versionId]: null }));
              }
            }}
          />
        )}
      </>
    );

    return historyView;
  }

  // Show prompts list
  const listContent = (
    <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
      {/* Header with Create button */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <span className={cn("font-medium", isFullpage ? "text-lg" : "text-sm")}>Prompts</span>
        <Button variant="outline" size="sm" onClick={handleCreateClick}>
          <Plus className="h-4 w-4 mr-1" />
          Create
        </Button>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-3 border-b flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search prompts by name..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange("")}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <ul className="divide-y">
          {prompts.map((prompt) => (
            <li key={prompt.id}>
              <button
                onClick={() => handlePromptClick(prompt)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                  "focus:outline-none focus:bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1">{prompt.name}</span>
                  {prompt.value != null && (
                    <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex-shrink-0">
                      {formatTokenCount(estimateTokens(prompt.value))}
                    </span>
                  )}
                  {prompt.usages && prompt.usages.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded flex-shrink-0">
                      {prompt.usages.length} {prompt.usages.length === 1 ? "usage" : "usages"}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate mt-1">
                  {prompt.usage_notation}
                </div>
                {prompt.description && (
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {prompt.description}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages} ({total} prompts)
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages || isLoading}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return isFullpage ? <Card className={wrapperClassName}>{listContent}</Card> : listContent;
}
