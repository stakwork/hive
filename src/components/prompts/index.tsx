"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Loader2, Copy, Check, Plus, Pencil, Save, X, Share2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

interface PromptUsage {
  workflow_id: number;
  workflow_name: string;
  step_id: string;
}

interface Prompt {
  id: number;
  name: string;
  description: string;
  usage_notation: string;
  usages?: PromptUsage[];
}

interface PromptDetail {
  id: number;
  name: string;
  value: string;
  description: string;
  usage_notation: string;
  current_version_id: number | null;
  version_count: number;
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

type ViewMode = "list" | "detail" | "create";

export function PromptsPanel({ workflowId, variant = "panel", onNavigateToWorkflow, workspaceSlug }: PromptsPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [copiedNotation, setCopiedNotation] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedUsages, setSelectedUsages] = useState<PromptUsage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Debounced search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Form state for create/edit
  const [formName, setFormName] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const isFullpage = variant === "fullpage";

  // Initialize search from URL on mount
  useEffect(() => {
    const nameParam = searchParams.get("name");
    if (nameParam) {
      setSearchQuery(nameParam);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when selecting a prompt (only in fullpage mode)
  const updateUrlWithPrompt = useCallback((promptId: number | null) => {
    if (!isFullpage) return;

    const params = new URLSearchParams(searchParams.toString());
    if (promptId) {
      params.set("prompt", promptId.toString());
    } else {
      params.delete("prompt");
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
        url += `&name=${encodeURIComponent(trimmedSearch)}`;
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

  const fetchPromptDetail = useCallback(async (promptId: number) => {
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
      } else {
        throw new Error("Failed to fetch prompt details");
      }
    } catch (err) {
      console.error("Error fetching prompt detail:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  // Fetch prompts when page or search changes
  useEffect(() => {
    fetchPrompts(page, debouncedSearchQuery);
  }, [page, debouncedSearchQuery, fetchPrompts]);

  // Check for prompt ID in URL on mount (only in fullpage mode)
  useEffect(() => {
    if (!isFullpage) return;

    const promptId = searchParams.get("prompt");
    if (promptId) {
      const id = parseInt(promptId, 10);
      if (!isNaN(id)) {
        setViewMode("detail");
        fetchPromptDetail(id);
      }
    }
  }, [isFullpage, searchParams, fetchPromptDetail]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(1);
    
    // Update URL with search parameter
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) {
      params.set("name", value.trim());
    } else {
      params.delete("name");
    }
    params.delete("page"); // Remove page param when searching
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  };

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
    updateUrlWithPrompt(null);
  };

  const handleCreateClick = () => {
    setViewMode("create");
    setFormName("");
    setFormValue("");
    setFormDescription("");
  };

  const handleEditClick = () => {
    if (selectedPrompt) {
      setFormValue(selectedPrompt.value);
      setFormDescription(selectedPrompt.description);
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (selectedPrompt) {
      setFormValue(selectedPrompt.value);
      setFormDescription(selectedPrompt.description);
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
        setPage(1);
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

  const totalPages = Math.ceil(total / pageSize);

  const handleCopyNotation = async () => {
    if (selectedPrompt?.usage_notation) {
      await navigator.clipboard.writeText(selectedPrompt.usage_notation);
      setCopiedNotation(true);
      setTimeout(() => setCopiedNotation(false), 2000);
    }
  };

  const handleSharePrompt = async (promptId: number) => {
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

  // Common wrapper classes for fullpage mode
  const wrapperClassName = isFullpage
    ? "w-full max-w-4xl mx-auto bg-card rounded-3xl shadow-sm border h-[70vh] overflow-hidden flex flex-col"
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
          <div className={cn("space-y-4", isFullpage && "max-w-2xl mx-auto")}>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="PROMPT_NAME"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={isSaving}
              />
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
                Value <span className="text-destructive">*</span>
              </label>
              <Textarea
                className={cn("mt-1 font-mono text-sm", isFullpage ? "min-h-[300px]" : "min-h-[200px]")}
                placeholder="Enter prompt value..."
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                disabled={isSaving}
              />
            </div>

            <div className="flex justify-end gap-2">
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
        </div>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Show prompt detail view
  if (viewMode === "detail" && selectedPrompt) {
    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium truncate flex-1">{selectedPrompt.name}</span>
          {!isEditing && (
            <>
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
            </>
          )}
        </div>

        {isLoadingDetail ? (
          <div className="flex items-center justify-center flex-1 p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-auto min-h-0 p-4">
            <div className={cn("space-y-4", isFullpage && "max-w-2xl mx-auto")}>
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
                  Prompt Value
                </label>
                {isEditing ? (
                  <Textarea
                    className={cn("mt-1 font-mono text-sm", isFullpage ? "min-h-[300px]" : "min-h-[200px]")}
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    disabled={isSaving}
                  />
                ) : (
                  <pre className={cn(
                    "mt-1 text-sm bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono",
                    isFullpage && "max-h-[400px] overflow-y-auto"
                  )}>
                    {selectedPrompt.value}
                  </pre>
                )}
              </div>

              {isEditing && (
                <div className="flex justify-end gap-2">
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

              {!isEditing && selectedPrompt.version_count > 0 && (
                <div className="text-xs text-muted-foreground">
                  Version count: {selectedPrompt.version_count}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
