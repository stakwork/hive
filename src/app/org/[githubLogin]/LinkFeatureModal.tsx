"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [selected, setSelected] = useState<FeatureResult | null>(null);
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
      setSelected(null);
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

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featureId: selected.id }),
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Feature to Milestone</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Workspace filter */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Workspace</Label>
            <Select value={workspaceFilter || "all"} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All Workspaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Workspaces</SelectItem>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search input */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Search Features</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
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
          <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/20">
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
                  const isSelected = selected?.id === f.id;
                  return (
                    <li
                      key={f.id}
                      className={`flex items-start justify-between px-3 py-2.5 cursor-pointer border-b last:border-0 hover:bg-muted/50 transition-colors ${
                        isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                      }`}
                      onClick={() => setSelected(isSelected ? null : f)}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{f.title}</p>
                        <p className="text-xs text-muted-foreground">{f.workspace.name}</p>
                      </div>
                      <span className="text-xs text-muted-foreground ml-3 shrink-0 mt-0.5">
                        {formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Selection preview */}
          {selected && (
            <div className="flex items-center justify-between rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">
                  {selected.title}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">{selected.workspace.name}</p>
              </div>
              <button
                className="ml-2 text-blue-500 hover:text-blue-700 shrink-0"
                onClick={() => setSelected(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selected || saving}>
            {saving ? "Linking…" : "Link Feature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
