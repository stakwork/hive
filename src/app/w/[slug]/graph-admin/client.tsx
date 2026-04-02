"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { SwarmCmd } from "@/services/swarm/cmd";

interface PaidEndpoint {
  id: number;
  route: string;
  method: string;
  status: boolean;
  fee: number;
}

interface GraphAdminClientProps {
  swarmUrl: string | null;
  workspaceSlug: string;
}

async function postGraphAdminCmd(workspaceSlug: string, cmd: SwarmCmd) {
  const res = await fetch(`/api/workspaces/${workspaceSlug}/graph-admin/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Request failed");
  }
  return res.json();
}

export function GraphAdminClient({ swarmUrl, workspaceSlug }: GraphAdminClientProps) {
  const hostname = swarmUrl ? new URL(swarmUrl).hostname : null;

  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [endpoints, setEndpoints] = useState<PaidEndpoint[] | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [endpointLoadingIds, setEndpointLoadingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!swarmUrl) {
      setInitialLoading(false);
      return;
    }

    let cancelled = false;
    async function loadInitialState() {
      try {
        const [visibilityRes, endpointsRes] = await Promise.allSettled([
          postGraphAdminCmd(workspaceSlug, {
            type: "Swarm",
            data: { cmd: "GetBoltwallAccessibility" },
          }),
          postGraphAdminCmd(workspaceSlug, {
            type: "Swarm",
            data: { cmd: "ListPaidEndpoint" },
          }),
        ]);

        if (cancelled) return;

        if (visibilityRes.status === "fulfilled") {
          setIsPublic(visibilityRes.value?.isPublic ?? false);
        } else {
          toast.error("Failed to load graph visibility");
        }

        if (endpointsRes.status === "fulfilled") {
          setEndpoints(endpointsRes.value?.endpoints ?? []);
        } else {
          toast.error("Failed to load payment routes");
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    loadInitialState();
    return () => {
      cancelled = true;
    };
  }, [swarmUrl, workspaceSlug]);

  async function handleVisibilityToggle(newValue: boolean) {
    const previous = isPublic;
    setIsPublic(newValue);
    setVisibilityLoading(true);
    try {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "UpdateBoltwallAccessibility", content: newValue },
      });
      toast.success("Graph visibility updated");
    } catch {
      setIsPublic(previous);
      toast.error("Failed to update visibility");
    } finally {
      setVisibilityLoading(false);
    }
  }

  async function handleEndpointToggle(endpoint: PaidEndpoint) {
    const newStatus = !endpoint.status;
    setEndpoints((prev) =>
      prev ? prev.map((e) => (e.id === endpoint.id ? { ...e, status: newStatus } : e)) : prev,
    );
    setEndpointLoadingIds((prev) => new Set(prev).add(endpoint.id));
    try {
      await postGraphAdminCmd(workspaceSlug, {
        type: "Swarm",
        data: { cmd: "UpdatePaidEndpoint", content: { id: endpoint.id, status: newStatus } },
      });
      toast.success(`Payment route ${newStatus ? "enabled" : "disabled"}`);
    } catch {
      setEndpoints((prev) =>
        prev ? prev.map((e) => (e.id === endpoint.id ? { ...e, status: endpoint.status } : e)) : prev,
      );
      toast.error("Failed to update payment route");
    } finally {
      setEndpointLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(endpoint.id);
        return next;
      });
    }
  }

  // No swarm configured
  if (!swarmUrl) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">Graph swarm is not yet configured for this workspace.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Links</CardTitle>
          <CardDescription>Open the graph viewer or swarm dashboard in a new tab.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {hostname ? (
            <>
              <Button asChild variant="outline">
                <a
                  href={`https://${hostname}:8000`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Graph Viewer
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`https://${hostname}:8800`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Swarm Dashboard
                </a>
              </Button>
            </>
          ) : (
            <>
              <Skeleton className="h-10 w-36" />
              <Skeleton className="h-10 w-36" />
            </>
          )}
        </CardContent>
      </Card>

      {/* Graph Visibility */}
      <Card>
        <CardHeader>
          <CardTitle>Graph Visibility</CardTitle>
          <CardDescription>Control whether your graph is publicly accessible.</CardDescription>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <div className="flex items-center gap-3">
              <Switch
                checked={isPublic ?? false}
                onCheckedChange={handleVisibilityToggle}
                disabled={visibilityLoading}
                aria-label="Toggle graph visibility"
              />
              {visibilityLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-sm font-medium">{isPublic ? "Public" : "Private"}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Routes */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Routes</CardTitle>
          <CardDescription>Enable or disable individual Lightning payment routes (boltwall).</CardDescription>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !endpoints || endpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment routes configured.</p>
          ) : (
            <ul className="divide-y">
              {endpoints.map((endpoint) => {
                const isLoading = endpointLoadingIds.has(endpoint.id);
                return (
                  <li key={endpoint.id} className="flex items-center justify-between py-3 gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="shrink-0 font-mono text-xs">
                        {endpoint.method}
                      </Badge>
                      <span className="text-sm truncate">/{endpoint.route}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">{endpoint.fee} sats</span>
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Switch
                          checked={endpoint.status}
                          onCheckedChange={() => handleEndpointToggle(endpoint)}
                          aria-label={`Toggle ${endpoint.route}`}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
