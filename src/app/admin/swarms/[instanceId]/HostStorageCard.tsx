"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, AlertTriangle, Info, ShieldAlert, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/lib/utils/format";
import type { HostStorageReading } from "@/services/swarm/host-storage";
import type {
  HostStorageReadResult,
  HostStorageReadReasonCode,
} from "@/services/swarm/host-storage-read";

interface HostStorageCardProps {
  instanceId: string;
}

/** Response body of GET /api/admin/swarms/[instanceId]/storage — the service
 * result serialized directly. */
type StorageResponse = HostStorageReadResult;

/**
 * Display-side truncation on top of the 256-char cap the parser applies. All
 * swarm-derived strings (mount paths, docker_root_dir, volume names, error
 * text) are third-party-controlled and render as plain React text nodes only —
 * never dangerouslySetInnerHTML, never attribute injection.
 */
const MAX_DISPLAY_LENGTH = 80;
function truncateForDisplay(text: string): string {
  return text.length > MAX_DISPLAY_LENGTH ? `${text.slice(0, MAX_DISPLAY_LENGTH)}…` : text;
}

/** Deterministic UTC rendering of the swarm's unix-seconds collection stamp. */
function formatCollectedAt(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) {
    return "unknown";
  }
  const iso = new Date(unixSeconds * 1000).toISOString();
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Human copy for the service's failure/skip reason codes. */
function failedStateCopy(reasonCode: HostStorageReadReasonCode | undefined): {
  title: string;
  detail: string;
} {
  switch (reasonCode) {
    case "CONFIG_INVALID":
      return {
        title: "This swarm is not configured for host storage reads",
        detail: "It has no swarm URL or no stored password, so storage cannot be read.",
      };
    case "WORKSPACE_DELETED":
      return {
        title: "The workspace linked to this swarm is deleted",
        detail: "Storage reads are disabled for offboarded workspaces.",
      };
    case "DECRYPT_FAILED":
      return {
        title: "The stored swarm password could not be decrypted",
        detail: "Fix the stored credential to restore storage telemetry.",
      };
    case "AUTH_FAILED":
      return {
        title: "Swarm authentication failed",
        detail: "The stored credentials were rejected by the swarm.",
      };
    case "STACK_ERROR":
      return {
        title: "The swarm reported a transport-level error",
        detail: "It returned a stack_error instead of a storage reading.",
      };
    case "MALFORMED":
      return {
        title: "The swarm returned an invalid storage response",
        detail: "The response failed validation and cannot be displayed.",
      };
    default:
      return {
        title: "Host storage read failed",
        detail: reasonCode ? `Reason: ${reasonCode}` : "No reason code was returned.",
      };
  }
}

/** Source trust badge copy: where the numbers came from. */
const SOURCE_LABELS: Record<string, string> = {
  node_exporter: "node_exporter",
  container_bind: "container_bind",
  none: "none",
};

export default function HostStorageCard({ instanceId }: HostStorageCardProps) {
  const [data, setData] = useState<StorageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStorage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/swarms/${instanceId}/storage`, {
        method: "GET",
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (body && typeof body === "object" && "outcome" in (body as Record<string, unknown>)) {
        setData(body as StorageResponse);
      } else if (!res.ok) {
        setError(`Request failed (${res.status})`);
      } else {
        setError("Unexpected response from the storage endpoint");
      }
    } catch {
      setError("Network error while fetching host storage");
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    fetchStorage();
  }, [fetchStorage]);

  const reading: HostStorageReading | undefined =
    data?.reading && (data.reading.status === "OK" || data.reading.status === "PARTIAL")
      ? data.reading
      : undefined;

  const gov = reading?.governingFilesystem ?? null;
  const hostVisible = reading?.hostVisible ?? true;
  const totalKnown = gov?.totalBytes != null;
  const usedKnown = gov?.usedBytes != null;
  const showHostCapacity = Boolean(reading) && hostVisible;
  const usedPct =
    totalKnown && usedKnown && (gov?.totalBytes ?? 0) > 0
      ? Math.min(100, Math.max(0, ((gov?.usedBytes ?? 0) / (gov?.totalBytes ?? 1)) * 100))
      : null;

  const neo4jVolumeNames = new Set(reading?.neo4j?.volumes ?? []);
  const otherVolumes = (reading?.volumes ?? []).filter((v) => !neo4jVolumeNames.has(v.name));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Host Storage</CardTitle>
        <Button variant="outline" size="sm" onClick={fetchStorage} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Reading host storage…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchStorage}>
              Retry
            </Button>
          </div>
        ) : data?.outcome === "no_swarm_record" ? (
          <div className="flex items-start gap-3 py-6">
            <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <div className="font-medium">No linked swarm record</div>
              <p className="mt-1 text-sm text-muted-foreground">
                This EC2 instance has no matching swarm record, so host storage telemetry is
                unavailable. This is a normal state for unlinked instances on the swarms list.
              </p>
            </div>
          </div>
        ) : data?.outcome === "ambiguous" ? (
          <div className="flex items-start gap-3 py-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <div className="font-medium text-destructive">Multiple linked swarm records</div>
              <p className="mt-1 text-sm text-muted-foreground">
                More than one swarm record points at this EC2 instance, so no reading is shown
                rather than an arbitrary one. Fix the linkage first.
              </p>
            </div>
          </div>
        ) : data?.outcome === "unreachable" ? (
          <div className="flex items-start gap-3 py-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
            <div>
              <div className="font-medium">Couldn&apos;t reach the swarm just now</div>
              <p className="mt-1 text-sm text-muted-foreground">
                The swarm exists but did not answer this moment
                {data.reasonCode ? ` (reason: ${data.reasonCode})` : ""}. Try Refresh to retry.
              </p>
            </div>
          </div>
        ) : data?.outcome === "failed" ? (
          (() => {
            const copy = failedStateCopy(data.reasonCode);
            return (
              <div className="flex items-start gap-3 py-6">
                <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium">{copy.title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {copy.detail}
                    {data.reasonCode ? ` (${data.reasonCode})` : ""}
                  </p>
                </div>
              </div>
            );
          })()
        ) : reading ? (
          <div className="space-y-4">
            {/* Meta row: status, source trust badge, collected time, cached label */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                className={
                  reading.status === "OK"
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                }
              >
                {reading.status}
              </Badge>
              <Badge variant="outline" data-testid="source-badge">
                {SOURCE_LABELS[reading.source] ?? reading.source}
              </Badge>
              <span className="text-muted-foreground">
                Collected: {formatCollectedAt(reading.collectedAt)}
              </span>
              {data?.cached ? (
                <span className="text-amber-600 dark:text-amber-400" data-testid="cached-label">
                  Cached reading from {formatCollectedAt(data.collectedAt ?? reading.collectedAt)}
                </span>
              ) : null}
            </div>

            {reading.status === "PARTIAL" ? (
              <p className="text-sm text-muted-foreground">
                Partial reading — some collectors reported problems (see warnings below).
              </p>
            ) : null}

            {/* host_visible: false — prominent notice; host-capacity figures suppressed */}
            {!hostVisible ? (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
                data-testid="host-invisible-notice"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <div>
                    <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      The swarm could not see the host
                    </div>
                    <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">
                      Host capacity figures are unavailable (host_visible: false). The volume sizes
                      below are container-level readings and may still be valid.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Headline: governing filesystem (host-capacity figures) */}
            {showHostCapacity ? (
              <div className="space-y-2" data-testid="host-capacity">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Free space on filesystem{" "}
                    <span className="font-mono">
                      {truncateForDisplay(reading.dockerRootFilesystem) || "unknown"}
                    </span>{" "}
                    (docker root{" "}
                    <span className="font-mono">
                      {truncateForDisplay(reading.dockerRootDir) || "unknown"}
                    </span>
                    ):
                  </span>
                  <span className="text-lg font-semibold" data-testid="free-bytes">
                    {formatBytes(gov?.freeBytes ?? null)}
                  </span>
                </div>
                {usedPct !== null ? (
                  <Progress value={usedPct} data-testid="capacity-progress" />
                ) : null}
                <div className="text-sm text-muted-foreground">
                  Total: {formatBytes(gov?.totalBytes ?? null)} · Used:{" "}
                  {formatBytes(gov?.usedBytes ?? null)} · Free: {formatBytes(gov?.freeBytes ?? null)}
                </div>
              </div>
            ) : null}

            {/* Neo4j */}
            <div className="space-y-1">
              <div className="text-sm font-medium">Neo4j volume</div>
              {reading.neo4j === null ? (
                <div className="text-sm text-muted-foreground" data-testid="neo4j-absent">
                  Not present
                </div>
              ) : (
                <div className="text-sm" data-testid="neo4j-size">
                  Size: {formatBytes(reading.neo4j.sizeBytes)}
                  {reading.neo4j.volumes.length > 0 ? (
                    <span className="ml-2 text-muted-foreground">
                      (
                      {reading.neo4j.volumes
                        .map((name) => truncateForDisplay(name))
                        .join(", ")}
                      )
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Other docker volumes */}
            {otherVolumes.length > 0 ? (
              <div>
                <div className="mb-1 text-sm font-medium">Docker volumes</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {otherVolumes.map((volume) => (
                      <TableRow key={volume.name}>
                        <TableCell className="font-mono text-sm">
                          {truncateForDisplay(volume.name)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatBytes(volume.sizeBytes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {/* Partial-failure warnings — a populated errors[] is a normal
                partial success, surfaced not discarded */}
            {reading.errors.length > 0 ? (
              <div className="space-y-1" data-testid="errors-warnings">
                {reading.errors.map((err, idx) => (
                  <div
                    key={`${err.collector}-${idx}`}
                    className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-800 dark:text-amber-200">
                      {truncateForDisplay(err.collector)}: {truncateForDisplay(err.reason)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No host storage reading available.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
