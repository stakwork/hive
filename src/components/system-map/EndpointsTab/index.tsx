"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SystemGraph, type SystemGraphSelection } from "@/components/protect/SystemGraph";
import { toast } from "sonner";
import type { ProtectEndpoint, ProtectEndpointsResponse } from "@/types/protect";

const ALL = "__all__";
const NO_SELECTION: SystemGraphSelection = { system: null, caller: null };

/** `stakwork/hive` -> `hive`; the full id stays available as a tooltip. */
function shortSystem(system: string): string {
  const slash = system.lastIndexOf("/");
  return slash === -1 ? system : system.slice(slash + 1);
}

function matchesSearch(endpoint: ProtectEndpoint, query: string): boolean {
  return (
    endpoint.name.toLowerCase().includes(query) ||
    endpoint.file.toLowerCase().includes(query) ||
    endpoint.verb.toLowerCase().includes(query) ||
    endpoint.callers.some((caller) => caller.system.toLowerCase().includes(query))
  );
}

export function EndpointsTab() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<ProtectEndpointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<SystemGraphSelection>(NO_SELECTION);

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
        systems: [],
        callersUnavailable: false,
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

  const endpoints = useMemo(() => data?.endpoints ?? [], [data?.endpoints]);

  const systems = useMemo(
    () => Array.from(new Set(endpoints.map((endpoint) => endpoint.system))).sort(),
    [endpoints],
  );
  const callerSystems = useMemo(
    () =>
      Array.from(
        new Set(endpoints.flatMap((endpoint) => endpoint.callers.map((caller) => caller.system))),
      ).sort(),
    [endpoints],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return endpoints.filter(
      (endpoint) =>
        (selection.system === null || endpoint.system === selection.system) &&
        (selection.caller === null ||
          endpoint.callers.some((caller) => caller.system === selection.caller)) &&
        (!query || matchesSearch(endpoint, query)),
    );
  }, [endpoints, search, selection]);

  const ready = !loading && data?.status === "ready";
  const showCallers = ready && !data.callersUnavailable;

  return (
    <div className="max-w-6xl space-y-4">
      <p className="text-sm text-muted-foreground">
        API endpoints in the knowledge graph and the systems that call them.
      </p>
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

      {ready && endpoints.length === 0 && (
        <Card data-testid="protect-endpoints-empty">
          <CardContent className="py-10 text-sm text-muted-foreground">
            No endpoints found in the knowledge graph.
          </CardContent>
        </Card>
      )}

      {ready && data.callersUnavailable && endpoints.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="protect-endpoints-no-callers">
          Caller information needs a newer swarm build; showing endpoints only.
        </p>
      )}

      {showCallers && systems.length > 1 && (
        <Card data-testid="protect-endpoints-systems">
          <CardContent className="space-y-3 py-5">
            <div>
              <h2 className="text-sm font-medium">System calls</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each ribbon is one system calling another, sized by how many endpoints it
                hits. Click a ribbon or a system to filter the list below. Generic paths such
                as <code>/health</code> can match endpoints in several systems.
              </p>
            </div>
            <SystemGraph endpoints={endpoints} selection={selection} onSelect={setSelection} />
          </CardContent>
        </Card>
      )}

      {ready && endpoints.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by path, method, file or caller"
              className="max-w-sm"
              data-testid="protect-endpoints-search"
            />
            {systems.length > 1 && (
              <Select
                value={selection.system ?? ALL}
                onValueChange={(value) =>
                  setSelection((current) => ({
                    ...current,
                    system: value === ALL ? null : value,
                  }))
                }
              >
                <SelectTrigger className="w-44" data-testid="protect-endpoints-system-filter">
                  <SelectValue placeholder="System" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All systems</SelectItem>
                  {systems.map((system) => (
                    <SelectItem key={system} value={system}>
                      {shortSystem(system)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {showCallers && callerSystems.length > 0 && (
              <Select
                value={selection.caller ?? ALL}
                onValueChange={(value) =>
                  setSelection((current) => ({
                    ...current,
                    caller: value === ALL ? null : value,
                  }))
                }
              >
                <SelectTrigger className="w-56" data-testid="protect-endpoints-caller-filter">
                  <SelectValue placeholder="Called by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any caller</SelectItem>
                  {callerSystems.map((system) => (
                    <SelectItem key={system} value={system}>
                      Called by {shortSystem(system)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p
              className="ml-auto text-sm text-muted-foreground"
              data-testid="protect-endpoints-count"
            >
              {filtered.length} of {endpoints.length} endpoints
            </p>
          </div>

          <Card data-testid="protect-endpoints-list">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Method</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>System</TableHead>
                    {showCallers && <TableHead>Called by</TableHead>}
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
                      <TableCell className="text-sm" title={endpoint.system}>
                        {shortSystem(endpoint.system)}
                      </TableCell>
                      {showCallers && (
                        <TableCell>
                          {endpoint.callers.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {endpoint.callers.map((caller) => (
                                <Badge
                                  key={caller.system}
                                  variant="secondary"
                                  className="font-mono text-xs"
                                  title={`${caller.system}: ${caller.callSites} call sites`}
                                >
                                  {shortSystem(caller.system)}
                                  <span className="ml-1 text-muted-foreground">
                                    {caller.callSites}
                                  </span>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      )}
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
  );
}
