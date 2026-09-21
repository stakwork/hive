"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { redirect } from "next/navigation";
import { Loader2, Waypoints } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { toast } from "sonner";
import type { ProtectEndpointsResponse } from "@/types/protect";

export default function ProtectEndpointsPage() {
  const canAccessDefense = useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION);
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ProtectEndpointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadEndpoints = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/protect/endpoints`);
      if (!response.ok) {
        throw new Error("Failed to load endpoints");
      }
      setData((await response.json()) as ProtectEndpointsResponse);
    } catch (error) {
      toast.error("Could not load endpoints", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setData({
        status: "error",
        endpoints: [],
        truncated: false,
        error: "Failed to load endpoints",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspace?.slug) {
      void loadEndpoints(workspace.slug);
    }
  }, [workspace?.slug, loadEndpoints]);

  const filtered = useMemo(() => {
    const endpoints = data?.endpoints ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return endpoints;
    return endpoints.filter(
      (endpoint) =>
        endpoint.name.toLowerCase().includes(query) ||
        endpoint.file.toLowerCase().includes(query) ||
        endpoint.verb.toLowerCase().includes(query),
    );
  }, [data?.endpoints, search]);

  if (!canAccessDefense) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Endpoints"
        description="API endpoints discovered in the workspace knowledge graph."
        icon={Waypoints}
      />

      <div className="max-w-5xl space-y-4">
        {loading && (
          <Card data-testid="protect-endpoints-loading">
            <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading endpoints…
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "error" && (
          <Card data-testid="protect-endpoints-error">
            <CardContent className="py-10 text-sm text-muted-foreground">
              {data.error || "Could not load endpoints from the knowledge graph."}
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "ready" && data.endpoints.length === 0 && (
          <Card data-testid="protect-endpoints-empty">
            <CardContent className="py-10 text-sm text-muted-foreground">
              No endpoints found in the knowledge graph.
            </CardContent>
          </Card>
        )}

        {!loading && data?.status === "ready" && data.endpoints.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by path, method or file"
                className="max-w-sm"
                data-testid="protect-endpoints-search"
              />
              <p className="text-sm text-muted-foreground" data-testid="protect-endpoints-count">
                {filtered.length} of {data.endpoints.length} endpoints
                {data.truncated && " (list truncated)"}
              </p>
            </div>

            <Card data-testid="protect-endpoints-list">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Method</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((endpoint) => (
                      <TableRow key={endpoint.refId} data-testid="protect-endpoint-row">
                        <TableCell>
                          {endpoint.verb && <Badge variant="outline">{endpoint.verb}</Badge>}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{endpoint.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {endpoint.file}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
