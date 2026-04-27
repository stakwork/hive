"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MilestoneResponse } from "@/types/initiatives";
import { formatDistanceToNow } from "date-fns";
import { Search, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
}

interface FeatureResult {
  id: string;
  title: string;
  updatedAt: string;
  workspace: { id: string; name: string };
}

export interface LinkFeatureModalProps {
  open: boolean;
  onClose: () => void;
  githubLogin: string;
  initiativeId: string;
  milestoneId: string;
  onLinked: (updatedMilestone: MilestoneResponse) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LinkFeatureModal({
  open,
  onClose,
  githubLogin,
  initiativeId,
  milestoneId,
  onLinked,
}: LinkFeatureModalProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FeatureResult[]>([]);
  // Multi-select: an ordered set of selected feature ids. We keep a
  // separate id→feature map so the bottom "selected" chips keep working
  // after the user changes the search query (results list churns) and
  // so the final PATCH can ship just ids without re-querying.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedById, setSelectedById] = useState<Record<string, FeatureResult>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch workspaces when modal opens
  useEffect(() => {
    if (!open) return;
    fetch(`/api/orgs/${githubLogin}/workspaces`)
      .then((r) => r.json())
      .then((data) => {
        const list: Workspace[] = Array.isArray(data) ? data : (data.workspaces ?? []);
        setWorkspaces(list);
      })
      .catch(() => {});
  }, [open, githubLogin]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setWorkspaceFilter("");
      setQuery("");
      setResults([]);
      setSelectedIds([]);
      setSelectedById({});
      setLoading(false);
    }
  }, [open]);

  // Search logic
  const runSearch = useCallback(
    async (q: string, wsId: string) => {
      if (q.length < 3) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("query", q);
        if (wsId) params.set("workspaceId", wsId);
        const url = `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}/features/search?${params}`;
        const res = await fetch(url);
        if (res.ok) {
          const data: FeatureResult[] = await res.json();
          setResults(data);
        }
      } finally {
        setLoading(false);
      }
    },
    [githubLogin, initiativeId, milestoneId]
  );

  // Debounce query input changes
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(value, workspaceFilter);
    }, 300);
  };

  // Immediate search on workspace filter change (if query already >= 3)
  const handleWorkspaceChange = (value: string) => {
    const ws = value === "all" ? "" : value;
    setWorkspaceFilter(ws);
    if (query.length >= 3) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runSearch(query, ws);
    }
  };

  const toggleSelected = (f: FeatureResult) => {
    setSelectedIds((prev) =>
      prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]
    );
    setSelectedById((prev) => {
      if (prev[f.id]) {
        const next = { ...prev };
        delete next[f.id];
        return next;
      }
      return { ...prev, [f.id]: f };
    });
  };

  const removeSelected = (id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    setSelectedById((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    try {
      // Use the incremental array form so we add all selected features in
      // one round-trip without clobbering whatever the milestone is
      // already linked to. The legacy `featureId` and `featureIds` (set)
      // forms would replace the existing set.
      const res = await fetch(
        `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addFeatureIds: selectedIds }),
        }
      );
      if (res.ok) {
        const updated: MilestoneResponse = await res.json();
        onLinked(updated);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const charsNeeded = Math.max(0, 3 - query.length);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[min(32rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Link Features to Milestone</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 min-w-0">
          {/* Workspace filter — native select avoids the portaled
              Radix dropdown which, inside a fixed-positioned dialog
              that itself sits inside transformed/sortable ancestors,
              has historically mis-anchored off-screen. */}
          <div className="space-y-1 min-w-0">
            <Label htmlFor="lf-workspace" className="text-xs text-muted-foreground">
              Workspace
            </Label>
            <select
              id="lf-workspace"
              value={workspaceFilter || "all"}
              onChange={(e) => handleWorkspaceChange(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">All Workspaces</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search input */}
          <div className="space-y-1 min-w-0">
            <Label className="text-xs text-muted-foreground">Search Features</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="h-8 pl-8 text-sm"
                placeholder="Type to search features…"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
              />
            </div>
            {charsNeeded > 0 && query.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Type {charsNeeded} more character{charsNeeded !== 1 ? "s" : ""} to search
              </p>
            )}
            {query.length === 0 && (
              <p className="text-xs text-muted-foreground">Type at least 3 characters to search</p>
            )}
          </div>

          {/* Results list */}
          <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/20 min-w-0">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                {query.length >= 3 ? "No features found" : "Search results will appear here"}
              </div>
            ) : (
              <ul>
                {results.map((f) => {
                  const isSelected = selectedSet.has(f.id);
                  return (
                    <li
                      key={f.id}
                      className={`flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b last:border-0 hover:bg-muted/50 transition-colors ${
                        isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                      }`}
                      onClick={() => toggleSelected(f)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(f)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 shrink-0"
                        aria-label={`Select ${f.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{f.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {f.workspace.name}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0 mt-0.5">
                        {formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Selection preview */}
          {selectedIds.length > 0 && (
            <div className="space-y-1 min-w-0">
              <p className="text-xs text-muted-foreground">
                {selectedIds.length} selected
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedIds.map((id) => {
                  const f = selectedById[id];
                  if (!f) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex max-w-full items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100"
                    >
                      <span className="truncate max-w-[14rem]" title={f.title}>
                        {f.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSelected(id)}
                        className="text-blue-500 hover:text-blue-700 shrink-0"
                        aria-label={`Remove ${f.title}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={selectedIds.length === 0 || saving}
          >
            {saving
              ? "Linking…"
              : selectedIds.length > 1
                ? `Link ${selectedIds.length} Features`
                : "Link Feature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
