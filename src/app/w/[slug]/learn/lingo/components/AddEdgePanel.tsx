"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";

interface AddEdgePanelProps {
  sourceRefId: string;
  workspaceSlug: string;
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onEdgeCreated: () => void;
}

const DEFAULT_EDGE_TYPE = "RELATED_TO";
const COMMON_EDGE_TYPES = ["RELATED_TO", "PART_OF", "DEPENDS_ON", "SYNONYM_OF", "EXTENDS", "HAS_DEFINITION", "SUPERSEDES"];

const EDGE_TYPE_MAP: Record<string, string[]> = {
  Lingo:            ["RELATED_TO", "PART_OF", "DEPENDS_ON", "SYNONYM_OF", "EXTENDS", "SUPERSEDES"],
  JargonDefinition: ["HAS_DEFINITION"],
  HiveFeature:      ["RELATED_TO", "DEPENDS_ON"],
  HiveTask:         ["RELATED_TO", "HAS_TASK"],
  HiveChatMessage:  ["HAS_MESSAGE"],
};

export function AddEdgePanel({
  sourceRefId,
  workspaceSlug,
  workspaceId: _workspaceId,
  isOpen,
  onClose,
  onEdgeCreated,
}: AddEdgePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LingoNode[]>([]);
  const [targetNode, setTargetNode] = useState<LingoNode | null>(null);
  const [edgeType, setEdgeType] = useState(DEFAULT_EDGE_TYPE);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive valid edge types based on selected target
  const validEdgeTypes = targetNode
    ? (EDGE_TYPE_MAP[targetNode.node_type] ?? ["RELATED_TO"])
    : COMMON_EDGE_TYPES;

  // Reset edgeType when targetNode changes
  useEffect(() => {
    if (targetNode) {
      const valid = EDGE_TYPE_MAP[targetNode.node_type] ?? ["RELATED_TO"];
      setEdgeType(valid[0]);
    }
  }, [targetNode]);

  // Search effect: empty query loads recent nodes from listing; typed query debounces to search
  useEffect(() => {
    if (!isOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setSearchError(false);

    if (!searchQuery.trim()) {
      setIsSearching(true);
      fetch(`/api/workspaces/${workspaceSlug}/lingo/nodes`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.success) { setSearchError(true); setSearchResults([]); return; }
          setSearchResults(Array.isArray(json.data?.nodes) ? json.data.nodes : []);
        })
        .catch(() => { setSearchError(true); setSearchResults([]); })
        .finally(() => setIsSearching(false));
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/lingo/nodes/search?q=${encodeURIComponent(searchQuery)}`,
        );
        const data = await res.json();
        if (!data.success) {
          setSearchError(true);
          setSearchResults([]);
        } else {
          setSearchResults(Array.isArray(data?.data) ? data.data : []);
        }
      } catch {
        setSearchError(true);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isOpen, searchQuery, workspaceSlug]);

  function handleClose() {
    setSearchQuery("");
    setSearchResults([]);
    setTargetNode(null);
    setEdgeType(DEFAULT_EDGE_TYPE);
    setSearchError(false);
    onClose();
  }

  async function handleConfirm() {
    if (!targetNode) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/lingo/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_ref_id: sourceRefId,
          target_ref_id: targetNode.ref_id,
          edge_type: edgeType,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Failed to create connection");
      }
      toast.success(`Connected to "${targetNode.name}"`);
      onEdgeCreated();
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent className="w-[400px] sm:w-[480px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>Add Connection</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* Search */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Search for a node</label>
            <Input
              placeholder="Type to search..."
              value={searchQuery}
              onChange={(e) => {
                setTargetNode(null);
                setSearchQuery(e.target.value);
              }}
              data-testid="node-search-input"
            />
          </div>

          {/* Search results */}
          {isSearching && (
            <p className="text-sm text-muted-foreground" data-testid="search-loading">
              Searching…
            </p>
          )}
          {!isSearching && searchResults.length > 0 && (
            <ul
              className="rounded-lg border divide-y overflow-hidden"
              data-testid="search-results"
            >
              {searchResults.map((result) => (
                <li key={result.ref_id ?? result.name}>
                  <button
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-accent/60 ${
                      targetNode?.ref_id === result.ref_id
                        ? "bg-primary/10 font-medium"
                        : ""
                    }`}
                    onClick={() => setTargetNode(result)}
                    data-testid={`search-result-${result.ref_id}`}
                  >
                    <span className="font-semibold">{result.name}</span>
                    <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground font-mono">
                      {result.node_type}
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground/60 font-mono">{result.ref_id}</p>
                    {result.definition && (
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {result.definition.length > 80
                          ? result.definition.slice(0, 80) + "…"
                          : result.definition}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground/60">
                      {formatDistanceToNow(new Date(result.date_added_to_graph * 1000), { addSuffix: true })}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!isSearching && searchError && (
            <p className="text-sm text-destructive" data-testid="search-error">
              Search unavailable — try again
            </p>
          )}
          {!isSearching && !searchError && searchQuery.trim() && searchResults.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="no-results">
              No nodes found for &quot;{searchQuery}&quot;
            </p>
          )}

          {/* Selected target */}
          {targetNode && (
            <div
              className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm"
              data-testid="selected-target"
            >
              <span className="font-medium">Selected:</span>{" "}
              <span className="font-medium">{targetNode.name}</span>
              <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-muted font-mono">
                {targetNode.node_type}
              </span>
              {targetNode.definition && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {targetNode.definition.slice(0, 80)}{targetNode.definition.length > 80 ? "…" : ""}
                </p>
              )}
            </div>
          )}

          {/* Edge type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Edge type</label>
            <Select value={edgeType} onValueChange={setEdgeType}>
              <SelectTrigger data-testid="edge-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {validEdgeTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex gap-2 justify-end">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!targetNode || isSubmitting}
            data-testid="confirm-add-edge"
          >
            {isSubmitting ? "Adding…" : "Add connection"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
