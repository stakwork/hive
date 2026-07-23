"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { ChevronLeft, Loader2, Plus, Trash2, Save, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockStepOutput {
  id: number | string;
  workflow_id: string;
  step_id: string;
  workflow_version_id: string | null;
  output: unknown;
  created_at?: string;
  updated_at?: string;
}

interface MockStepOutputsResponse {
  success: boolean;
  data: MockStepOutput[];
}

interface MockStepOutputDetailResponse {
  success: boolean;
  data: MockStepOutput;
}

type ViewMode = "list" | "detail" | "create";

interface MockStepOutputsPanelProps {
  variant?: "panel" | "fullpage";
  workspaceSlug?: string;
  workflowId?: string | number;
  workflowVersionId?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true only if `raw` is valid JSON (including 0, false, "", null). */
function isValidJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

function outputToString(output: unknown): string {
  if (output === null || output === undefined) return "null";
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MockStepOutputsPanel({
  variant = "panel",
  workflowId,
  workflowVersionId,
}: MockStepOutputsPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isFullpage = variant === "fullpage";

  // Filter state
  const [filterWorkflowId, setFilterWorkflowId] = useState(
    () => searchParams?.get("workflow_id") ?? ""
  );
  const [filterVersionId, setFilterVersionId] = useState(
    () => searchParams?.get("workflow_version_id") ?? ""
  );

  // List state
  const [items, setItems] = useState<MockStepOutput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Selected detail
  const [selectedItem, setSelectedItem] = useState<MockStepOutput | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Saving / deleting
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Form state (create & edit)
  const [formWorkflowId, setFormWorkflowId] = useState("");
  const [formStepId, setFormStepId] = useState("");
  const [formVersionId, setFormVersionId] = useState("");
  const [formOutput, setFormOutput] = useState("");
  const [outputError, setOutputError] = useState<string | null>(null);

  // ─── Derived: visibleItems (panel only — client-side version merge) ──────────

  const visibleItems = useMemo(() => {
    if (isFullpage) return items;
    if (!workflowVersionId) return items;
    return items.filter(
      (item) =>
        // version-specific match (string comparison to handle numeric/string id mismatch)
        String(item.workflow_version_id) === String(workflowVersionId) ||
        // global entry (no version)
        item.workflow_version_id == null ||
        item.workflow_version_id === ""
    );
  }, [items, isFullpage, workflowVersionId]);

  // ─── URL sync ───────────────────────────────────────────────────────────────

  const updateUrl = useCallback(
    (overrides: {
      id?: string | number | null;
      workflow_id?: string;
      workflow_version_id?: string;
    }) => {
      if (!isFullpage) return;
      const params = new URLSearchParams(searchParams?.toString() ?? "");

      if ("id" in overrides) {
        if (overrides.id != null) {
          params.set("id", String(overrides.id));
        } else {
          params.delete("id");
        }
      }
      if ("workflow_id" in overrides) {
        if (overrides.workflow_id) {
          params.set("workflow_id", overrides.workflow_id);
        } else {
          params.delete("workflow_id");
        }
      }
      if ("workflow_version_id" in overrides) {
        if (overrides.workflow_version_id) {
          params.set("workflow_version_id", overrides.workflow_version_id);
        } else {
          params.delete("workflow_version_id");
        }
      }

      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(newUrl, { scroll: false });
    },
    [isFullpage, pathname, router, searchParams]
  );

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchList = useCallback(
    async (workflowId: string, versionId?: string): Promise<MockStepOutput[]> => {
      setIsLoading(true);
      setListError(null);
      try {
        let url = `/api/workflow/mock-step-outputs?workflow_id=${encodeURIComponent(workflowId)}`;
        if (versionId) {
          url += `&workflow_version_id=${encodeURIComponent(versionId)}`;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch mock step outputs");
        const data: MockStepOutputsResponse = await res.json();
        if (!data.success) throw new Error("Failed to fetch mock step outputs");
        setItems(data.data);
        return data.data;
      } catch (err) {
        setListError(err instanceof Error ? err.message : "An error occurred");
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const fetchDetail = useCallback(async (id: string | number) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/workflow/mock-step-outputs/${id}`);
      if (!res.ok) throw new Error("Failed to fetch mock step output");
      const data: MockStepOutputDetailResponse = await res.json();
      if (!data.success) throw new Error("Failed to fetch mock step output");
      return data.data;
    } catch (err) {
      console.error("Error fetching mock step output detail:", err);
      return null;
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  // ─── Panel auto-fetch (keyed on workflowId only) ────────────────────────────

  useEffect(() => {
    if (isFullpage) return;
    if (!workflowId || isNaN(Number(workflowId))) return;

    let cancelled = false;

    setFilterWorkflowId(String(workflowId));
    setIsLoading(true);
    setListError(null);

    fetch(
      `/api/workflow/mock-step-outputs?workflow_id=${encodeURIComponent(String(workflowId))}`
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch mock step outputs");
        return res.json() as Promise<MockStepOutputsResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!data.success) throw new Error("Failed to fetch mock step outputs");
        setItems(data.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : "An error occurred");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Keyed on workflowId ONLY — version switching is a pure client-side re-derivation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullpage, workflowId]);

  // ─── Initialise from URL on mount (fullpage only) ───────────────────────────

  useEffect(() => {
    if (!isFullpage) return;

    const urlWorkflowId = searchParams?.get("workflow_id") ?? "";
    const urlVersionId = searchParams?.get("workflow_version_id") ?? "";
    const urlId = searchParams?.get("id");

    if (urlWorkflowId) {
      setFilterWorkflowId(urlWorkflowId);
      setFilterVersionId(urlVersionId);

      fetchList(urlWorkflowId, urlVersionId || undefined).then((fetched) => {
        if (urlId) {
          const matched = fetched.find((e) => String(e.id) === urlId);
          if (matched) {
            openDetail(matched);
          } else {
            // fall back to fetching directly
            fetchDetail(urlId).then((detail) => {
              if (detail) openDetail(detail);
            });
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullpage]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const openDetail = (item: MockStepOutput) => {
    setSelectedItem(item);
    setFormWorkflowId(item.workflow_id);
    setFormStepId(item.step_id);
    setFormVersionId(item.workflow_version_id ?? "");
    setFormOutput(outputToString(item.output));
    setOutputError(null);
    setSaveError(null);
    setViewMode("detail");
    updateUrl({
      id: item.id,
      workflow_id: item.workflow_id,
      workflow_version_id: item.workflow_version_id ?? "",
    });
  };

  const handleItemClick = (item: MockStepOutput) => openDetail(item);

  const handleBackToList = () => {
    setSelectedItem(null);
    setViewMode("list");
    setSaveError(null);
    setOutputError(null);
    updateUrl({ id: null });
  };

  const handleCreateClick = () => {
    setFormWorkflowId(isFullpage ? filterWorkflowId : String(workflowId ?? ""));
    setFormStepId("");
    setFormVersionId(isFullpage ? filterVersionId : (workflowVersionId ?? ""));
    setFormOutput("");
    setOutputError(null);
    setSaveError(null);
    setViewMode("create");
    updateUrl({ id: null });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!filterWorkflowId.trim()) return;
    updateUrl({
      workflow_id: filterWorkflowId,
      workflow_version_id: filterVersionId,
      id: null,
    });
    fetchList(filterWorkflowId, filterVersionId || undefined);
  };

  const validateOutput = (raw: string): boolean => {
    if (!isValidJson(raw)) {
      setOutputError("Invalid JSON — please enter valid JSON (e.g. null, 0, false, {}, [])");
      return false;
    }
    setOutputError(null);
    return true;
  };

  /** Refetch helper — routes through version-less workflow-scoped call in panel
   *  variant so globals are never dropped, and through the filter-driven call
   *  in fullpage variant to preserve existing URL-sync behaviour. */
  const refetchAfterMutation = useCallback(() => {
    if (!isFullpage && workflowId && !isNaN(Number(workflowId))) {
      fetchList(String(workflowId));
    } else if (isFullpage && filterWorkflowId) {
      fetchList(filterWorkflowId, filterVersionId || undefined);
    }
  }, [isFullpage, workflowId, filterWorkflowId, filterVersionId, fetchList]);

  const handleSaveEdit = async () => {
    if (!selectedItem) return;
    if (!validateOutput(formOutput)) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/workflow/mock-step-outputs/${selectedItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: formWorkflowId,
          step_id: formStepId,
          workflow_version_id: formVersionId || null,
          output: JSON.parse(formOutput),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to save");
      }

      const data: MockStepOutputDetailResponse = await res.json();
      if (!data.success) throw new Error("Failed to save");

      setSelectedItem(data.data);
      setFormWorkflowId(data.data.workflow_id);
      setFormStepId(data.data.step_id);
      setFormVersionId(data.data.workflow_version_id ?? "");
      setFormOutput(outputToString(data.data.output));

      refetchAfterMutation();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!formWorkflowId.trim() || !formStepId.trim()) {
      setSaveError("workflow_id and step_id are required");
      return;
    }
    if (!validateOutput(formOutput)) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/workflow/mock-step-outputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: formWorkflowId,
          step_id: formStepId,
          workflow_version_id: formVersionId || null,
          output: JSON.parse(formOutput),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create");
      }

      const data: MockStepOutputDetailResponse = await res.json();
      if (!data.success) throw new Error("Failed to create");

      const created = data.data;

      if (!isFullpage && workflowId && !isNaN(Number(workflowId))) {
        // Panel: refetch via version-less workflow-scoped call, then open detail
        const refreshed = await fetchList(String(workflowId));
        const matched =
          refreshed.find(
            (e) =>
              e.workflow_id === created.workflow_id &&
              e.step_id === created.step_id &&
              (e.workflow_version_id ?? null) === (created.workflow_version_id ?? null)
          ) ?? created;
        openDetail(matched);
      } else {
        // Fullpage: existing behaviour — re-fetch with filter context and open detail
        const newWorkflowId = formWorkflowId;
        const newVersionId = formVersionId;
        const refreshed = await fetchList(newWorkflowId, newVersionId || undefined);

        setFilterWorkflowId(newWorkflowId);
        setFilterVersionId(newVersionId);
        updateUrl({
          workflow_id: newWorkflowId,
          workflow_version_id: newVersionId,
        });

        const matched =
          refreshed.find(
            (e) =>
              e.workflow_id === created.workflow_id &&
              e.step_id === created.step_id &&
              (e.workflow_version_id ?? null) === (created.workflow_version_id ?? null)
          ) ?? created;

        openDetail(matched);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem) return;
    setIsDeleting(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/workflow/mock-step-outputs/${selectedItem.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to delete");
      }

      handleBackToList();
      refetchAfterMutation();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const wrapperClassName = isFullpage
    ? "w-full bg-card rounded-3xl shadow-sm border flex-1 overflow-hidden flex flex-col min-h-0"
    : "";

  // ─── Create view ─────────────────────────────────────────────────────────────

  if (viewMode === "create") {
    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium flex-1">Create Mock Step Output</span>
        </div>

        <div className="flex-1 overflow-auto min-h-0 p-4">
          <div className={cn("space-y-4", isFullpage && "max-w-3xl mx-auto")}>
            <FormFields
              workflowId={formWorkflowId}
              stepId={formStepId}
              versionId={formVersionId}
              output={formOutput}
              outputError={outputError}
              disabled={isSaving}
              onWorkflowIdChange={setFormWorkflowId}
              onStepIdChange={setFormStepId}
              onVersionIdChange={setFormVersionId}
              onOutputChange={(v) => {
                setFormOutput(v);
                if (outputError) setOutputError(null);
              }}
              isFullpage={isFullpage}
            />
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 p-3 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleBackToList} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create
              </>
            )}
          </Button>
        </div>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // ─── Detail view ─────────────────────────────────────────────────────────────

  if (viewMode === "detail" && selectedItem) {
    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving || isDeleting}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium truncate flex-1">
            {selectedItem.step_id} — {selectedItem.workflow_id}
          </span>
        </div>

        {isLoadingDetail ? (
          <div className="flex items-center justify-center p-8 flex-1">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto min-h-0 p-4">
              <div className={cn("space-y-4", isFullpage && "max-w-3xl mx-auto")}>
                <FormFields
                  workflowId={formWorkflowId}
                  stepId={formStepId}
                  versionId={formVersionId}
                  output={formOutput}
                  outputError={outputError}
                  disabled={isSaving || isDeleting}
                  onWorkflowIdChange={setFormWorkflowId}
                  onStepIdChange={setFormStepId}
                  onVersionIdChange={setFormVersionId}
                  onOutputChange={(v) => {
                    setFormOutput(v);
                    if (outputError) setOutputError(null);
                  }}
                  isFullpage={isFullpage}
                />
                {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              </div>
            </div>

            <div className="flex justify-between gap-2 p-3 border-t flex-shrink-0">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isDeleting || isSaving}>
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1" />
                    )}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Mock Step Output?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove the mock output for step &quot;{selectedItem.step_id}&quot;. This
                      action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button onClick={handleSaveEdit} disabled={isSaving || isDeleting}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // ─── List view ───────────────────────────────────────────────────────────────

  const listContent = (
    <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
      {/* Filter bar — fullpage only */}
      {isFullpage ? (
        <form onSubmit={handleSearch} className="flex items-end gap-2 p-3 border-b flex-shrink-0 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">
              Workflow ID <span className="text-destructive">*</span>
            </label>
            <Input
              placeholder="Enter workflow ID"
              value={filterWorkflowId}
              onChange={(e) => setFilterWorkflowId(e.target.value)}
              className="h-8 text-sm"
              data-testid="filter-workflow-id"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1">
              Version ID (optional)
            </label>
            <Input
              placeholder="Enter version ID"
              value={filterVersionId}
              onChange={(e) => setFilterVersionId(e.target.value)}
              className="h-8 text-sm"
              data-testid="filter-version-id"
            />
          </div>
          <Button type="submit" size="sm" disabled={!filterWorkflowId.trim() || isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-1">Search</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCreateClick}
            data-testid="create-button"
          >
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </form>
      ) : (
        /* Panel header — lightweight, just "New" button */
        <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Mock Step Outputs
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCreateClick}
            data-testid="create-button"
          >
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </div>
      )}

      {/* List body */}
      <div className="flex-1 overflow-auto min-h-0">
        {isFullpage && !filterWorkflowId.trim() ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 p-8">
            <Search className="h-8 w-8 opacity-30" />
            <p>Enter a Workflow ID above to load mock step outputs.</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center p-8 h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : listError ? (
          <div className="flex items-center justify-center p-8 h-full">
            <p className="text-destructive text-sm">{listError}</p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 p-8">
            <p>No mock step outputs found for this workflow.</p>
            <Button variant="outline" size="sm" onClick={handleCreateClick}>
              <Plus className="h-4 w-4 mr-1" />
              Create one
            </Button>
          </div>
        ) : (
          <ul className="divide-y" data-testid="mock-step-output-list">
            {visibleItems.map((item) => (
              <li key={item.id}>
                <button
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                  onClick={() => handleItemClick(item)}
                  data-testid={`item-${item.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.step_id}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Workflow: {item.workflow_id}
                      {item.workflow_version_id ? ` · v${item.workflow_version_id}` : ""}
                    </p>
                  </div>
                  <ChevronLeft className="h-4 w-4 rotate-180 text-muted-foreground flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return isFullpage ? <Card className={wrapperClassName}>{listContent}</Card> : listContent;
}

// ─── Shared form fields ───────────────────────────────────────────────────────

interface FormFieldsProps {
  workflowId: string;
  stepId: string;
  versionId: string;
  output: string;
  outputError: string | null;
  disabled: boolean;
  onWorkflowIdChange: (v: string) => void;
  onStepIdChange: (v: string) => void;
  onVersionIdChange: (v: string) => void;
  onOutputChange: (v: string) => void;
  isFullpage: boolean;
}

function FormFields({
  workflowId,
  stepId,
  versionId,
  output,
  outputError,
  disabled,
  onWorkflowIdChange,
  onStepIdChange,
  onVersionIdChange,
  onOutputChange,
  isFullpage,
}: FormFieldsProps) {
  return (
    <>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Workflow ID <span className="text-destructive">*</span>
        </label>
        <Input
          className="mt-1"
          placeholder="Enter workflow ID"
          value={workflowId}
          onChange={(e) => onWorkflowIdChange(e.target.value)}
          disabled={disabled}
          data-testid="form-workflow-id"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Step ID <span className="text-destructive">*</span>
        </label>
        <Input
          className="mt-1"
          placeholder="Enter step ID"
          value={stepId}
          onChange={(e) => onStepIdChange(e.target.value)}
          disabled={disabled}
          data-testid="form-step-id"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Workflow Version ID{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          className="mt-1"
          placeholder="Leave blank for workflow-wide mock"
          value={versionId}
          onChange={(e) => onVersionIdChange(e.target.value)}
          disabled={disabled}
          data-testid="form-version-id"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Output (JSON) <span className="text-destructive">*</span>
        </label>
        <Textarea
          className={cn(
            "mt-1 font-mono text-sm",
            isFullpage ? "min-h-[300px]" : "min-h-[150px]",
            outputError && "border-destructive"
          )}
          placeholder='Enter valid JSON, e.g. {"result": "ok"} or null or false'
          value={output}
          onChange={(e) => onOutputChange(e.target.value)}
          disabled={disabled}
          data-testid="form-output"
        />
        {outputError && <p className="text-xs text-destructive mt-1">{outputError}</p>}
      </div>
    </>
  );
}
