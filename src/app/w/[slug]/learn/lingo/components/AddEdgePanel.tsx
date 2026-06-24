"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
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
import type { JargonNode } from "@/app/api/mock/lingo/nodes";

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

export function AddEdgePanel({
  sourceRefId,
  workspaceSlug,
  workspaceId,
  isOpen,
  onClose,
  onEdgeCreated,
}: AddEdgePanelProps) {
  const [nodeTypes, setNodeTypes] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState<string>("Lingo");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<JargonNode[]>([]);
  const [targetNode, setTargetNode] = useState<JargonNode | null>(null);
  const [edgeType, setEdgeType] = useState(DEFAULT_EDGE_TYPE);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load schema on open
  useEffect(() => {
    if (!isOpen) return;
    fetch(`/api/swarm/jarvis/schema?id=${workspaceId}`)
      .then((r) => r.json())
      .then((data) => {
        const types: string[] = data?.node_types ?? data?.types ?? [];
        if (types.length > 0) setNodeTypes(types);
      })
      .catch(() => {
        // silently ignore schema load failures
      });
  }, [isOpen, workspaceId]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (selectedType) params.set("type", selectedType);
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/lingo/nodes/search?${params}`,
        );
        const data = await res.json();
        setSearchResults(Array.isArray(data?.data) ? data.data : []);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, selectedType, workspaceSlug]);

  function handleClose() {
    setSearchQuery("");
    setSearchResults([]);
    setTargetNode(null);
    setEdgeType(DEFAULT_EDGE_TYPE);
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
          {/* Node type filter */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Node type</label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger data-testid="node-type-select">
                <SelectValue placeholder="Any type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Lingo">Lingo</SelectItem>
                {nodeTypes
                  .filter((t) => t !== "Lingo")
                  .map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

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
                <li key={result.ref_id}>
                  <button
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-accent/60 ${
                      targetNode?.ref_id === result.ref_id
                        ? "bg-primary/10 font-medium"
                        : ""
                    }`}
                    onClick={() => setTargetNode(result)}
                    data-testid={`search-result-${result.ref_id}`}
                  >
                    {result.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!isSearching && searchQuery.trim() && searchResults.length === 0 && (
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
              <span className="font-medium">Selected:</span> {targetNode.name}
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
                {COMMON_EDGE_TYPES.map((t) => (
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
