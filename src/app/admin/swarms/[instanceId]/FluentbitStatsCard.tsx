"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FluentbitRates, FluentbitStatsReading } from "@/services/swarm/fluentbit-stats";
import type {
  FluentbitStatsReadReasonCode,
  FluentbitStatsReadResult,
} from "@/services/swarm/fluentbit-stats-read";
import type {
  FluentbitContainerToday,
  FluentbitIngest,
} from "@/services/swarm/fluentbit-stats-rollups";

interface FluentbitStatsCardProps {
  instanceId: string;
}

type FluentbitResponse = FluentbitStatsReadResult & {
  ingest?: FluentbitIngest | null;
  containersToday?: FluentbitContainerToday[] | null;
};

/**
 * Display-side truncation on top of the 256-char cap the parser applies.
 * Swarm-derived error strings render as plain React text nodes only.
 */
const MAX_DISPLAY_LENGTH = 80;
const UNAVAILABLE = "unavailable";

function truncateForDisplay(text: string): string {
  return text.length > MAX_DISPLAY_LENGTH ? `${text.slice(0, MAX_DISPLAY_LENGTH)}…` : text;
}

function isPresent(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

/** Byte counts: null/non-finite → "unavailable"; a true 0 → "0 B". Never uses formatBytes. */
function formatByteCount(value: number | null | undefined): string {
  if (!isPresent(value)) return UNAVAILABLE;
  if (value === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
  if (value < k) {
    const digits = value < 10 ? 2 : 1;
    return `${parseFloat(value.toFixed(digits))} B`;
  }
  const i = Math.min(Math.floor(Math.log(value) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((value / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Integer counters: null/non-finite → "unavailable"; a true 0 → "0". */
function formatCount(value: number | null | undefined): string {
  if (!isPresent(value)) return UNAVAILABLE;
  if (value === 0) return "0";
  return value.toLocaleString("en-US");
}

function formatRateNumber(rate: number): string {
  if (rate === 0) return "0";
  if (rate >= 100) return Math.round(rate).toLocaleString("en-US");
  const fixed = rate >= 10 ? rate.toFixed(1) : rate.toFixed(2);
  return String(parseFloat(fixed));
}

function withWindow(value: string, windowSeconds: number | null): string {
  if (windowSeconds === null || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return value;
  }
  return `${value} over last ${windowSeconds}s`;
}

/** Byte rates: null/non-finite → "unavailable"; a true 0 → "0/s". */
function formatByteRate(value: number | null | undefined, windowSeconds: number | null): string {
  if (!isPresent(value)) return UNAVAILABLE;
  if (value === 0) return withWindow("0/s", windowSeconds);
  return withWindow(`${formatByteCount(value)}/s`, windowSeconds);
}

/** Record rates: null/non-finite → "unavailable"; a true 0 → "0/s". */
function formatRecordRate(value: number | null | undefined, windowSeconds: number | null): string {
  if (!isPresent(value)) return UNAVAILABLE;
  return withWindow(`${formatRateNumber(value)}/s`, windowSeconds);
}

/** Deterministic UTC rendering of the swarm's unix-seconds collection stamp. */
function formatCollectedAt(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) {
    return "unknown";
  }
  const iso = new Date(unixSeconds * 1000).toISOString();
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function failedStateCopy(reasonCode: FluentbitStatsReadReasonCode | undefined): {
  title: string;
  detail: string;
} {
  switch (reasonCode) {
    case "CONFIG_INVALID":
      return {
        title: "This swarm is not configured for FluentBit stats reads",
        detail: "It has no swarm URL or no stored password, so FluentBit stats cannot be read.",
      };
    case "WORKSPACE_DELETED":
      return {
        title: "The workspace linked to this swarm is deleted",
        detail: "FluentBit stats reads are disabled for offboarded workspaces.",
      };
    case "DECRYPT_FAILED":
      return {
        title: "The stored swarm password could not be decrypted",
        detail: "Fix the stored credential to restore FluentBit telemetry.",
      };
    case "AUTH_FAILED":
      return {
        title: "Swarm authentication failed",
        detail: "The stored credentials were rejected by the swarm.",
      };
    case "STACK_ERROR":
      return {
        title: "The swarm reported a transport-level error",
        detail: "It returned a stack_error instead of a FluentBit stats reading.",
      };
    case "MALFORMED":
      return {
        title: "The swarm returned an invalid FluentBit stats response",
        detail: "The response failed validation and cannot be displayed.",
      };
    default:
      return {
        title: "FluentBit stats read failed",
        detail: reasonCode ? `Reason: ${reasonCode}` : "No reason code was returned.",
      };
  }
}

function statusBadgeClass(status: FluentbitStatsReading["status"]): string {
  if (status === "OK") {
    return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  }
  if (status === "UNAVAILABLE") {
    return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
}

type CounterKind = "bytes" | "count";
type RateKind = "bytes" | "records";

interface CounterRow {
  key: string;
  label: string;
  kind: CounterKind;
  value: number | null;
  rateKey?: keyof FluentbitRates;
  rateKind?: RateKind;
}

function counterRows(reading: FluentbitStatsReading): CounterRow[] {
  return [
    {
      key: "inputBytes",
      label: "Input bytes",
      kind: "bytes",
      value: reading.inputBytes,
      rateKey: "inputBytesPerSec",
      rateKind: "bytes",
    },
    {
      key: "inputRecords",
      label: "Input records",
      kind: "count",
      value: reading.inputRecords,
      rateKey: "inputRecordsPerSec",
      rateKind: "records",
    },
    {
      key: "outputProcBytes",
      label: "Output processed bytes",
      kind: "bytes",
      value: reading.outputProcBytes,
      rateKey: "outputProcBytesPerSec",
      rateKind: "bytes",
    },
    {
      key: "outputProcRecords",
      label: "Output processed records",
      kind: "count",
      value: reading.outputProcRecords,
      rateKey: "outputProcRecordsPerSec",
      rateKind: "records",
    },
    {
      key: "filterDropRecords",
      label: "Filter drop records",
      kind: "count",
      value: reading.filterDropRecords,
    },
    {
      key: "outputDroppedRecords",
      label: "Output dropped records",
      kind: "count",
      value: reading.outputDroppedRecords,
    },
    {
      key: "outputErrors",
      label: "Output errors",
      kind: "count",
      value: reading.outputErrors,
    },
    {
      key: "retriesFailed",
      label: "Retries failed",
      kind: "count",
      value: reading.retriesFailed,
    },
    {
      key: "uptimeSeconds",
      label: "Uptime (seconds)",
      kind: "count",
      value: reading.uptimeSeconds,
    },
  ];
}

function formatCounterValue(kind: CounterKind, value: number | null): string {
  return kind === "bytes" ? formatByteCount(value) : formatCount(value);
}

function formatRateValue(
  rateKind: RateKind,
  value: number | null | undefined,
  windowSeconds: number | null,
): string {
  return rateKind === "bytes"
    ? formatByteRate(value, windowSeconds)
    : formatRecordRate(value, windowSeconds);
}

const INGEST_BUCKETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7Days", label: "Last 7 days" },
] as const;

function IngestBucketsSection({ ingest }: { ingest: FluentbitIngest }) {
  return (
    <div className="space-y-2" data-testid="ingest-buckets">
      <h3 className="text-sm font-medium">Ingested Volume</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Window</TableHead>
            <TableHead className="text-right">Bytes</TableHead>
            <TableHead className="text-right">Records</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {INGEST_BUCKETS.map((bucket) => {
            const value = ingest[bucket.key];
            return (
              <TableRow key={bucket.key} data-testid={`ingest-row-${bucket.key}`}>
                <TableCell className="text-sm">{bucket.label}</TableCell>
                <TableCell
                  className="text-right font-mono text-sm"
                  data-testid={`ingest-${bucket.key}-bytes`}
                >
                  {formatByteCount(value.inputBytes)}
                </TableCell>
                <TableCell
                  className="text-right font-mono text-sm"
                  data-testid={`ingest-${bucket.key}-records`}
                >
                  {formatCount(value.inputRecords)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ContainersTodaySection({ rows }: { rows: FluentbitContainerToday[] }) {
  return (
    <div className="space-y-2" data-testid="containers-today">
      <h3 className="text-sm font-medium">Containers Today</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No container breakdown for today.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Container</TableHead>
              <TableHead className="text-right">Bytes</TableHead>
              <TableHead className="text-right">Records</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.containerName}
                data-testid={`container-today-${row.containerName}`}
              >
                <TableCell className="text-sm">{row.containerName}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatByteCount(row.inputBytes)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCount(row.inputRecords)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function HistorySections({ data }: { data: FluentbitResponse }) {
  const ingest = data.ingest;
  const containersToday = data.containersToday;
  const showIngest = ingest != null;
  const showContainers = Array.isArray(containersToday);
  if (!showIngest && !showContainers) return null;
  return (
    <div className="space-y-4">
      {showIngest ? <IngestBucketsSection ingest={ingest} /> : null}
      {showContainers ? <ContainersTodaySection rows={containersToday} /> : null}
    </div>
  );
}

export default function FluentbitStatsCard({ instanceId }: FluentbitStatsCardProps) {
  const [data, setData] = useState<FluentbitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/swarms/${instanceId}/fluentbit`, {
        method: "GET",
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (body && typeof body === "object" && "outcome" in (body as Record<string, unknown>)) {
        setData(body as FluentbitResponse);
      } else if (!res.ok) {
        setError(`Request failed (${res.status})`);
      } else {
        setError("Unexpected response from the FluentBit stats endpoint");
      }
    } catch {
      setError("Network error while fetching FluentBit stats");
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const reading: FluentbitStatsReading | undefined =
    data?.reading &&
    (data.reading.status === "OK" ||
      data.reading.status === "PARTIAL" ||
      data.reading.status === "UNAVAILABLE")
      ? data.reading
      : undefined;

  const maskUnavailable = reading?.status === "UNAVAILABLE" || reading?.available === false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>FluentBit Stats</CardTitle>
        <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Reading FluentBit stats…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={fetchStats}>
              Retry
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-4">
            {data.outcome === "no_swarm_record" ? (
              <div className="flex items-start gap-3 py-2">
                <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium">No linked swarm record</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This EC2 instance has no matching swarm record, so FluentBit stats are
                    unavailable. This is a normal state for unlinked instances on the swarms
                    list.
                  </p>
                </div>
              </div>
            ) : data.outcome === "ambiguous" ? (
              <div className="flex items-start gap-3 py-2">
                <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
                <div>
                  <div className="font-medium text-destructive">Multiple linked swarm records</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    More than one swarm record points at this EC2 instance, so no reading is
                    shown rather than an arbitrary one. Fix the linkage first.
                  </p>
                </div>
              </div>
            ) : data.outcome === "unreachable" ? (
              <div className="flex items-start gap-3 py-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                <div>
                  <div className="font-medium">Couldn&apos;t reach the swarm just now</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The swarm exists but did not answer this moment
                    {data.reasonCode ? ` (reason: ${data.reasonCode})` : ""}. Try Refresh to
                    retry.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={fetchStats}>
                    Retry
                  </Button>
                </div>
              </div>
            ) : data.outcome === "failed" ? (
              (() => {
                const copy = failedStateCopy(data.reasonCode);
                return (
                  <div className="flex items-start gap-3 py-2">
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
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    className={statusBadgeClass(reading.status)}
                    data-testid="fluentbit-status-badge"
                  >
                    {reading.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    Collected: {formatCollectedAt(reading.collectedAt)}
                  </span>
                  {data.cached ? (
                    <span
                      className="text-amber-600 dark:text-amber-400"
                      data-testid="cached-label"
                    >
                      Cached reading from{" "}
                      {formatCollectedAt(data.collectedAt ?? reading.collectedAt)}
                    </span>
                  ) : null}
                </div>

                {reading.status === "PARTIAL" ? (
                  <p className="text-sm text-muted-foreground">
                    Partial reading — some collectors reported problems (see warnings below).
                  </p>
                ) : null}

                {maskUnavailable ? (
                  <p className="text-sm text-muted-foreground" data-testid="unavailable-notice">
                    FluentBit is not currently reporting stats. Counters and rates are
                    unavailable.
                  </p>
                ) : null}

                <div data-testid="fluentbit-counters">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {counterRows(reading).map((row) => {
                        const valueText = maskUnavailable
                          ? UNAVAILABLE
                          : formatCounterValue(row.kind, row.value);
                        const rateText =
                          row.rateKey && row.rateKind
                            ? maskUnavailable
                              ? UNAVAILABLE
                              : formatRateValue(
                                  row.rateKind,
                                  reading.rates?.[row.rateKey],
                                  reading.rateWindowSeconds,
                                )
                            : null;
                        return (
                          <TableRow key={row.key} data-testid={`fluentbit-row-${row.key}`}>
                            <TableCell className="text-sm">{row.label}</TableCell>
                            <TableCell
                              className="text-right font-mono text-sm"
                              data-testid={`counter-${row.key}`}
                            >
                              {valueText}
                            </TableCell>
                            <TableCell
                              className="text-right font-mono text-sm text-muted-foreground"
                              data-testid={`rate-${row.key}`}
                            >
                              {rateText}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {reading.errors.length > 0 ? (
                  <div className="space-y-1" data-testid="errors-warnings">
                    {reading.errors.map((err, idx) => (
                      <div
                        key={`${err}-${idx}`}
                        className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span className="text-amber-800 dark:text-amber-200">
                          {truncateForDisplay(err)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                No FluentBit stats reading available.
              </div>
            )}
            <HistorySections data={data} />
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No FluentBit stats reading available.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
