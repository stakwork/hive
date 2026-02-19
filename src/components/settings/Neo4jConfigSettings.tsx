"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface Neo4jConfig {
  heap_initial_gb: number;
  heap_max_gb: number;
  pagecache_gb: number;
  tx_total_gb: number;
  tx_max_gb: number;
  checkpoint_iops: number;
}

const DEFAULT_CONFIG: Neo4jConfig = {
  heap_initial_gb: 6,
  heap_max_gb: 6,
  pagecache_gb: 8,
  tx_total_gb: 4,
  tx_max_gb: 1,
  checkpoint_iops: 500,
};

function toNumberOr(defaultValue: number, value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return defaultValue;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : defaultValue;
}

export function Neo4jConfigSettings() {
  const { workspace } = useWorkspace();
  const { canAdmin } = useWorkspaceAccess();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [original, setOriginal] = useState<Neo4jConfig | null>(null);
  const [form, setForm] = useState<Neo4jConfig>(DEFAULT_CONFIG);

  const hasChanges = useMemo(() => {
    if (!original) return true;
    return (
      form.heap_initial_gb !== original.heap_initial_gb ||
      form.heap_max_gb !== original.heap_max_gb ||
      form.pagecache_gb !== original.pagecache_gb ||
      form.tx_total_gb !== original.tx_total_gb ||
      form.tx_max_gb !== original.tx_max_gb ||
      form.checkpoint_iops !== original.checkpoint_iops
    );
  }, [form, original]);

  const fetchConfig = useCallback(async () => {
    if (!workspace?.slug) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/settings/neo4j`);
      if (!response.ok) {
        if (response.status !== 404) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || error.message || "Failed to load Neo4j settings");
        }
        setOriginal(DEFAULT_CONFIG);
        setForm(DEFAULT_CONFIG);
        return;
      }

      const data = (await response.json()) as { config?: Neo4jConfig | null };
      const config = data.config ?? DEFAULT_CONFIG;
      setOriginal(config);
      setForm(config);
    } catch (error) {
      console.error("Failed to fetch Neo4j config:", error);
      toast.error(error instanceof Error ? error.message : "Failed to load Neo4j settings");
      setOriginal(DEFAULT_CONFIG);
      setForm(DEFAULT_CONFIG);
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.slug]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = useCallback(async () => {
    if (!workspace?.slug) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/workspaces/${workspace.slug}/settings/neo4j`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: form }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || payload.message || "Failed to update Neo4j settings");
      }

      toast.success("Neo4j settings saved. Restart triggered.");
      setOriginal(form);
    } catch (error) {
      console.error("Failed to save Neo4j config:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save Neo4j settings");
    } finally {
      setIsSaving(false);
    }
  }, [form, workspace?.slug]);

  if (!canAdmin) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Neo4j Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Neo4j Configuration</CardTitle>
        <CardDescription>
          Update sphinx-swarm Neo4j memory and checkpoint settings. Saving will update config and restart the Neo4j container.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="neo4j-heap-initial">Heap initial (GB)</Label>
            <Input
              id="neo4j-heap-initial"
              inputMode="numeric"
              value={String(form.heap_initial_gb)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  heap_initial_gb: toNumberOr(prev.heap_initial_gb, e.target.value),
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="neo4j-heap-max">Heap max (GB)</Label>
            <Input
              id="neo4j-heap-max"
              inputMode="numeric"
              value={String(form.heap_max_gb)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  heap_max_gb: toNumberOr(prev.heap_max_gb, e.target.value),
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="neo4j-pagecache">Page cache (GB)</Label>
            <Input
              id="neo4j-pagecache"
              inputMode="numeric"
              value={String(form.pagecache_gb)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  pagecache_gb: toNumberOr(prev.pagecache_gb, e.target.value),
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="neo4j-tx-total">TX total (GB)</Label>
            <Input
              id="neo4j-tx-total"
              inputMode="numeric"
              value={String(form.tx_total_gb)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  tx_total_gb: toNumberOr(prev.tx_total_gb, e.target.value),
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="neo4j-tx-max">TX max (GB)</Label>
            <Input
              id="neo4j-tx-max"
              inputMode="numeric"
              value={String(form.tx_max_gb)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  tx_max_gb: toNumberOr(prev.tx_max_gb, e.target.value),
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="neo4j-checkpoint-iops">Checkpoint IOPS</Label>
            <Input
              id="neo4j-checkpoint-iops"
              inputMode="numeric"
              value={String(form.checkpoint_iops)}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  checkpoint_iops: toNumberOr(prev.checkpoint_iops, e.target.value),
                }))
              }
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>

          <Button
            variant="outline"
            onClick={fetchConfig}
            disabled={isSaving}
          >
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

