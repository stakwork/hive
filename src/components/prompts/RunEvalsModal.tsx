"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface JarvisNode {
  ref_id: string;
  properties?: {
    name?: string;
    description?: string;
    [key: string]: unknown;
  };
}

interface RunEvalsModalProps {
  open: boolean;
  onClose: () => void;
  versionLabel: string;
  workspaceSlug: string;
  onConfirm: (evalSetId: string) => void;
}

export function RunEvalsModal({
  open,
  onClose,
  versionLabel,
  workspaceSlug,
  onConfirm,
}: RunEvalsModalProps) {
  const [evalSets, setEvalSets] = useState<JarvisNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      return;
    }

    const fetchEvalSets = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/workspaces/${workspaceSlug}/evals`);
        if (!res.ok) throw new Error("Failed to fetch eval sets");
        const data = await res.json();
        setEvalSets((data.data?.nodes ?? data.nodes ?? []) as JarvisNode[]);
      } catch {
        setEvalSets([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvalSets();
  }, [open, workspaceSlug]);

  const handleRun = () => {
    if (!selectedId) return;
    onConfirm(selectedId);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run Evals — {versionLabel}</DialogTitle>
        </DialogHeader>

        <div className="min-h-[120px] max-h-[320px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : evalSets.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground text-center px-4">
              No eval sets found. Create one in the Evals dashboard.
            </div>
          ) : (
            <div className="space-y-1 py-1">
              {evalSets.map((es) => {
                const name = es.properties?.name ?? es.ref_id;
                const description = es.properties?.description;
                const isSelected = selectedId === es.ref_id;
                return (
                  <button
                    key={es.ref_id}
                    onClick={() => setSelectedId(es.ref_id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md border transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-primary",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <div className="text-sm font-medium">{name}</div>
                    {description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleRun} disabled={!selectedId || isLoading}>
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
