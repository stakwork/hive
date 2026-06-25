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
import { ChevronLeft, ChevronRight, Loader2, Plus, Minus, Pencil, Save, X, Search, History, Trash2, Zap, Upload, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { estimateTokens, formatTokenCount } from "@/lib/utils/token-estimate";
import { useDebounce } from "@/hooks/useDebounce";
import { diffLines } from "diff";

// Sentinel ID for representing the current live version
const CURRENT_VERSION_SENTINEL = -1;

// Script list item (from API list endpoint)
interface Script {
  id: number;
  name: string;
  description: string;
  usage_notation: string;
  value?: string;
}

interface ScriptDetail {
  id: number;
  name: string;
  value: string;
  description: string;
  usage_notation: string;
  current_version_id: number | null;
  published_version_id: number | null;
  version_count: number;
  public_url: string | null;
}

interface ScriptVersion {
  id: number;
  version_number: number;
  created_at: string;
  whodunnit: string | null;
  event: string | null;
}

interface ScriptsListResponse {
  success: boolean;
  data: {
    scripts: Script[];
    total: number;
    size: number;
    page: number;
  };
}

interface ScriptDetailResponse {
  success: boolean;
  data: ScriptDetail;
}

interface ScriptsPanelProps {
  variant?: "panel" | "fullpage";
  workspaceSlug?: string;
}

type ViewMode = "list" | "detail" | "create" | "history";

export function ScriptsPanel({ variant = "panel", workspaceSlug }: ScriptsPanelProps) {
  const { timezone } = useUserTimezone();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = useState<ScriptDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Version history state
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishingVersionId, setPublishingVersionId] = useState<number | null>(null);
  const [selectedVersionAId, setSelectedVersionAId] = useState<number | null>(null);
  const [selectedVersionBId, setSelectedVersionBId] = useState<number | null>(null);
  const [versionAContent, setVersionAContent] = useState<string | null>(null);
  const [versionBContent, setVersionBContent] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [previewVersionDescription, setPreviewVersionDescription] = useState<string | null>(null);

  // Debounced search query
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Form state for create/edit
  const [formName, setFormName] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");

  // Debounced form value for live token count
  const debouncedFormValue = useDebounce(formValue, 300);
  const liveTokenCount = estimateTokens(debouncedFormValue);

  const isFullpage = variant === "fullpage";

  // Initialize search from URL on mount
  useEffect(() => {
    const searchParam = searchParams.get("search");
    if (searchParam) {
      setSearchQuery(searchParam);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update URL when selecting a script (only in fullpage mode)
  const updateUrlWithScript = useCallback((scriptId: number | null, versionId?: number | null) => {
    if (!isFullpage) return;

    const params = new URLSearchParams(searchParams.toString());
    if (scriptId) {
      params.set("script", scriptId.toString());
    } else {
      params.delete("script");
      params.delete("version");
    }
    if (versionId != null) {
      params.set("version", versionId.toString());
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

  const fetchScripts = useCallback(async (pageNum: number, searchTerm?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      let url = `/api/workflow/scripts?page=${pageNum}`;
      const trimmedSearch = searchTerm?.trim();
      if (trimmedSearch) {
        url += `&search=${encodeURIComponent(trimmedSearch)}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch scripts");
      }
      const data: ScriptsListResponse = await response.json();
      if (data.success) {
        setScripts(data.data.scripts);
        setTotal(data.data.total);
        setPageSize(data.data.size);
      } else {
        throw new Error("Failed to fetch scripts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchScriptDetail = useCallback(async (scriptId: number) => {
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`/api/workflow/scripts/${scriptId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch script details");
      }
      const data: ScriptDetailResponse = await response.json();
      if (data.success) {
        setSelectedScript(data.data);
        setFormValue(data.data.value);
        setFormDescription(data.data.description);
      } else {
        throw new Error("Failed to fetch script details");
      }
    } catch (err) {
      console.error("Error fetching script detail:", err);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  const fetchVersionList = useCallback(async (scriptId: number) => {
    setIsLoadingVersions(true);
    try {
      const response = await fetch(`/api/workflow/scripts/${scriptId}/versions`);
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

  const fetchVersionContent = useCallback(async (scriptId: number, versionId: number): Promise<string | null> => {
    try {
      const response = await fetch(`/api/workflow/scripts/${scriptId}/versions/${versionId}`);
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

  const fetchVersionDetail = useCallback(async (scriptId: number, versionId: number): Promise<{ value: string; description: string } | null> => {
    try {
      const response = await fetch(`/api/workflow/scripts/${scriptId}/versions/${versionId}`);
      if (!response.ok) throw new Error("Failed to fetch version detail");
      const data = await response.json();
      if (data.success) return { value: data.data.value as string, description: data.data.description as string };
      return null;
    } catch (err) {
      console.error("Error fetching version detail:", err);
      return null;
    }
  }, []);

  // Fetch scripts when page or search changes
  useEffect(() => {
    fetchScripts(page, debouncedSearchQuery);
  }, [page, debouncedSearchQuery, fetchScripts]);

  // Check for script ID (and optional version) in URL on mount (only in fullpage mode)
  useEffect(() => {
    if (!isFullpage) return;

    const scriptId = searchParams.get("script");
    const versionId = searchParams.get("version");
    if (scriptId) {
      const id = parseInt(scriptId, 10);
      if (!isNaN(id)) {
        setViewMode("detail");
        fetchScriptDetail(id).then(() => {
          if (versionId) {
            const vid = parseInt(versionId, 10);
            if (!isNaN(vid)) {
              fetchVersionList(id).then(() => {
                setViewMode("history");
                setSelectedVersionAId(vid);
                fetchVersionContent(id, vid).then((content) => {
                  if (content !== null) {
                    setVersionAContent(content);
                  }
                });
              });
            }
          }
        });
      }
    }
  }, [isFullpage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    goToPage(1);
  };

  // Update URL when debounced search changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentSearch = params.get("search") || "";
    const trimmedQuery = debouncedSearchQuery.trim();

    if (currentSearch !== trimmedQuery) {
      if (trimmedQuery) {
        params.set("search", trimmedQuery);
      } else {
        params.delete("search");
      }
      params.delete("page");
      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(newUrl, { scroll: false });
    }
  }, [debouncedSearchQuery, pathname, router]);

  const handleScriptClick = (script: Script) => {
    setViewMode("detail");
    setIsEditing(false);
    fetchScriptDetail(script.id);
    updateUrlWithScript(script.id);
  };

  const handleBackToList = () => {
    setSelectedScript(null);
    setViewMode("list");
    setIsEditing(false);
    setFormName("");
    setFormValue("");
    setFormDescription("");
    updateUrlWithScript(null);
  };

  const handleCreateClick = () => {
    setViewMode("create");
    setFormName("");
    setFormValue("");
    setFormDescription("");
  };

  const handleEditClick = () => {
    if (selectedScript) {
      setFormValue(selectedScript.value);
      setFormDescription(selectedScript.description);
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (selectedScript) {
      setFormValue(selectedScript.value);
      setFormDescription(selectedScript.description);
    }
    setIsEditing(false);
  };

  const handleCreateScript = async () => {
    if (!formName.trim() || !formValue.trim()) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/workflow/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          value: formValue.trim(),
          description: formDescription.trim(),
        }),
      });

      if (!response.ok) throw new Error("Failed to create script");

      const data = await response.json();
      if (data.success) {
        handleBackToList();
        fetchScripts(1);
        goToPage(1);
      } else {
        throw new Error("Failed to create script");
      }
    } catch (err) {
      console.error("Error creating script:", err);
      setError(err instanceof Error ? err.message : "Failed to create script");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateScript = async () => {
    if (!selectedScript || !formValue.trim()) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/workflow/scripts/${selectedScript.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: formValue.trim(),
          description: formDescription.trim(),
        }),
      });

      if (!response.ok) throw new Error("Failed to update script");

      const data = await response.json();
      if (data.success) {
        await fetchScriptDetail(selectedScript.id);
        setIsEditing(false);
        fetchScripts(page);
      } else {
        throw new Error("Failed to update script");
      }
    } catch (err) {
      console.error("Error updating script:", err);
      setError(err instanceof Error ? err.message : "Failed to update script");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteScript = async () => {
    if (!selectedScript) return;

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/workflow/scripts/${selectedScript.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete script");
      }

      const data = await response.json();
      if (data.success) {
        handleBackToList();
        fetchScripts(1);
      } else {
        throw new Error("Failed to delete script");
      }
    } catch (err) {
      console.error("Error deleting script:", err);
      setError(err instanceof Error ? err.message : "Failed to delete script");
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const handleHistoryClick = async () => {
    if (!selectedScript) return;
    setViewMode("history");
    await fetchVersionList(selectedScript.id);
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
    setFormDescription(previewVersionDescription ?? selectedScript!.description);
    setVersions([]);
    setSelectedVersionAId(null);
    setSelectedVersionBId(null);
    setVersionAContent(null);
    setVersionBContent(null);
    setPreviewVersionDescription(null);
    setViewMode("detail");
    setIsEditing(true);
  };

  const handlePublishVersion = async (versionId: number) => {
    if (!selectedScript) return;
    setIsPublishing(true);
    setPublishingVersionId(versionId);
    setError(null);
    try {
      const response = await fetch(
        `/api/workflow/scripts/${selectedScript.id}/versions/${versionId}/publish`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Failed to publish version");
      const data = await response.json();
      if (!data.success) throw new Error("Failed to publish version");
      await fetchScriptDetail(selectedScript.id);
      setViewMode("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish version");
    } finally {
      setIsPublishing(false);
      setPublishingVersionId(null);
    }
  };

  const handleVersionClick = (versionId: number) => {
    if (selectedVersionAId === null) {
      setSelectedVersionAId(versionId);
    } else if (selectedVersionBId === null) {
      if (versionId === selectedVersionAId) {
        setSelectedVersionAId(null);
      } else {
        setSelectedVersionBId(versionId);
      }
    } else {
      if (versionId === selectedVersionAId) {
        setSelectedVersionAId(selectedVersionBId);
        setSelectedVersionBId(null);
      } else if (versionId === selectedVersionBId) {
        setSelectedVersionBId(null);
      } else {
        setSelectedVersionBId(versionId);
      }
    }
  };

  // Fetch version content when A (and optionally B) is selected
  useEffect(() => {
    if (!selectedScript || !selectedVersionAId) {
      setVersionAContent(null);
      setVersionBContent(null);
      setPreviewVersionDescription(null);
      return;
    }

    const fetchContent = async () => {
      setIsLoadingDiff(true);
      try {
        if (selectedVersionBId) {
          const resolveA = selectedVersionAId === CURRENT_VERSION_SENTINEL
            ? Promise.resolve({ value: selectedScript.value, description: selectedScript.description })
            : fetchVersionDetail(selectedScript.id, selectedVersionAId);

          const resolveB = selectedVersionBId === CURRENT_VERSION_SENTINEL
            ? Promise.resolve(selectedScript.value)
            : fetchVersionContent(selectedScript.id, selectedVersionBId);

          const [detailA, contentB] = await Promise.all([resolveA, resolveB]);
          setVersionAContent(detailA ? detailA.value : null);
          setPreviewVersionDescription(detailA ? detailA.description : null);
          setVersionBContent(contentB);
        } else {
          if (selectedVersionAId === CURRENT_VERSION_SENTINEL) {
            setVersionAContent(selectedScript.value);
            setPreviewVersionDescription(selectedScript.description);
          } else {
            const detail = await fetchVersionDetail(selectedScript.id, selectedVersionAId);
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
  }, [selectedScript, selectedVersionAId, selectedVersionBId, fetchVersionContent, fetchVersionDetail]);

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

  if (isLoading && scripts.length === 0 && viewMode === "list") {
    const content = (
      <div className={cn("flex items-center justify-center p-8", isFullpage ? "h-[400px]" : "h-full")}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground text-sm">Loading scripts...</span>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  if (error && scripts.length === 0 && viewMode === "list") {
    const content = (
      <div className={cn("flex items-center justify-center p-8", isFullpage ? "h-[400px]" : "h-full")}>
        <div className="text-destructive text-sm">{error}</div>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Create script view
  if (viewMode === "create") {
    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium flex-1">Create New Script</span>
        </div>

        <div className="flex-1 overflow-auto min-h-0 p-4">
          <div className={cn("space-y-4", isFullpage && "max-w-3xl mx-auto")}>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="SCRIPT_NAME"
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
                Value <span className="text-destructive">*</span>
              </label>
              <Textarea
                className={cn("mt-1 font-mono text-sm", isFullpage ? "min-h-[500px]" : "min-h-[200px]")}
                placeholder="Enter script value..."
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
            onClick={handleCreateScript}
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
                Create Script
              </>
            )}
          </Button>
        </div>
      </div>
    );
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Show script detail view
  if (viewMode === "detail" && selectedScript) {
    const isPublished = selectedScript.current_version_id !== null &&
      selectedScript.current_version_id === selectedScript.published_version_id;

    const content = (
      <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
        <div className="flex items-center gap-2 p-3 border-b flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleBackToList} disabled={isSaving}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-sm font-medium truncate flex-1">{selectedScript.name}</span>
          {!isEditing && (
            isPublished ? (
              <Badge variant="default" className="bg-green-600 text-white text-xs flex-shrink-0">Published</Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-600 text-xs flex-shrink-0">Unpublished</Badge>
            )
          )}
          {!isEditing && (
            <>
              {!isPublished && selectedScript.current_version_id && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isPublishing}>
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
                        This will make the current version the live script used by all workflows. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handlePublishVersion(selectedScript.current_version_id!)}>
                        Publish
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
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
                    <AlertDialogTitle>Delete Script</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete &quot;{selectedScript.name}&quot;? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteScript}
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
              {!isEditing && selectedScript.version_count > 1 && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleHistoryClick}
                    className="w-full"
                  >
                    <History className="h-4 w-4 mr-2" />
                    View History ({selectedScript.version_count} versions)
                  </Button>
                </div>
              )}

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
                    {selectedScript.description || <span className="text-muted-foreground italic">No description</span>}
                  </p>
                )}
              </div>

              {selectedScript.public_url && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Source File
                  </label>
                  <div className="mt-1">
                    <a
                      href={selectedScript.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {selectedScript.public_url}
                    </a>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Script Value
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {formatTokenCount(estimateTokens(isEditing ? debouncedFormValue : selectedScript.value))}
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
                  <pre className="mt-1 text-sm bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                    {selectedScript.value}
                  </pre>
                )}
              </div>
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
              onClick={handleUpdateScript}
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
  if (viewMode === "history" && selectedScript) {
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
          const lines = part.value.split("\n").filter((line) => line !== "");
          if (part.added) acc.additions += lines.length;
          else if (part.removed) acc.deletions += lines.length;
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
          <span className="text-sm font-medium truncate flex-1">Version History - {selectedScript.name}</span>
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
                    <button
                      onClick={() => handleVersionClick(CURRENT_VERSION_SENTINEL)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded transition-colors text-sm",
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
                          {selectedScript.published_version_id !== null &&
                            selectedScript.current_version_id === selectedScript.published_version_id && (
                              <Badge variant="default" className="text-xs flex-shrink-0 bg-green-600 text-white">
                                Published
                              </Badge>
                            )}
                          <span className="text-xs text-muted-foreground">Latest</span>
                        </div>
                      </div>
                    </button>
                  );
                })()}

                {/* Historical Versions */}
                {versions.length > 0 ? (
                  versions.map((version) => {
                    const isSelectedA = selectedVersionAId === version.id;
                    const isSelectedB = selectedVersionBId === version.id;
                    const isSelected = isSelectedA || isSelectedB;
                    const isLive =
                      version.id === selectedScript.published_version_id &&
                      version.id !== selectedScript.current_version_id;

                    return (
                      <div key={version.id} className="relative flex items-center gap-2">
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
                          {(version.whodunnit || version.event) && (
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                              {version.whodunnit && <span>{version.whodunnit}</span>}
                              {version.event && (
                                <Badge variant="outline" className="text-xs py-0">{version.event}</Badge>
                              )}
                            </div>
                          )}
                        </button>

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
                                  This will make v{version.version_number} the live script used by all workflows. This cannot be undone.
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
                          const v = versions.find((v) => v.id === selectedVersionAId);
                          return v ? `v${v.version_number}` : "Version";
                        })()}
                      </span>
                      {selectedVersionAId !== CURRENT_VERSION_SENTINEL && (
                        <Button variant="outline" size="sm" onClick={handleEditFromVersion}>
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
                            const lines = part.value.split("\n");
                            if (lines[lines.length - 1] === "") lines.pop();

                            return lines.map((line: string, lineIndex: number) => {
                              let bgColor = "";
                              let textColor = "";
                              let Icon: typeof Plus | typeof Minus | null = null;

                              if (part.added) {
                                bgColor = "bg-green-50 dark:bg-green-950/50";
                                textColor = "text-green-800 dark:text-green-300";
                                Icon = Plus;
                              } else if (part.removed) {
                                bgColor = "bg-red-50 dark:bg-red-950/50";
                                textColor = "text-red-800 dark:text-red-300";
                                Icon = Minus;
                              }

                              return (
                                <tr key={`${index}-${lineIndex}`} className={bgColor}>
                                  <td className={cn(
                                    "w-8 px-2 py-0.5 text-right select-none border-r border-border/50",
                                    textColor || "text-muted-foreground"
                                  )}>
                                    {Icon && <Icon className="w-3 h-3 inline" />}
                                    {!Icon && <span className="opacity-30"> </span>}
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
    return isFullpage ? <Card className={wrapperClassName}>{content}</Card> : content;
  }

  // Show scripts list
  const listContent = (
    <div className={cn("flex flex-col", isFullpage ? "h-full" : "h-full overflow-hidden")}>
      {/* Header with Create button */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <span className={cn("font-medium", isFullpage ? "text-lg" : "text-sm")}>Scripts</span>
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
            placeholder="Search scripts by name..."
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
          {scripts.map((script) => (
            <li key={script.id}>
              <button
                onClick={() => handleScriptClick(script)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                  "focus:outline-none focus:bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1">{script.name}</span>
                  {script.value != null && (
                    <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex-shrink-0">
                      {formatTokenCount(estimateTokens(script.value))}
                    </span>
                  )}
                </div>
                {script.description && (
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {script.description}
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
            Page {page} of {totalPages} ({total} scripts)
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
