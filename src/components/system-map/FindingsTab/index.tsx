"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { SystemMapFinding, SystemMapFindingsResponse } from "@/types/system-map";
import { RelatedNodes } from "./RelatedNodes";
import { FindingVerify } from "./FindingVerify";
import { BatchVerifyBar, MAX_BATCH } from "./BatchVerifyBar";

const SEVERITY_CLASS: Record<string, string> = {
  critical: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300",
  high: "border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-300",
  medium: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  info: "border-muted-foreground/30 bg-muted text-muted-foreground",
};
const NO_SEVERITY = "unrated";

function severityOf(finding: SystemMapFinding): string {
  return finding.severity ?? NO_SEVERITY;
}

function matches(finding: SystemMapFinding, query: string): boolean {
  return [finding.title, finding.cweId, finding.file, finding.status, finding.description, finding.refId].some((v) =>
    v?.toLowerCase().includes(query),
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={cn("capitalize", SEVERITY_CLASS[severity])}>
      {severity}
    </Badge>
  );
}

function FindingCard({
  finding,
  selected,
  onSelect,
  checksVersion,
  onVerdict,
}: {
  finding: SystemMapFinding;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  checksVersion: number;
  onVerdict: () => void;
}) {
  const [open, setOpen] = useState(false);
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : null;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Card data-testid="finding-row">
      <CardContent className="p-0">
        <div className="flex items-start">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelect(v === true)}
            className="ml-3 mt-3 shrink-0"
            aria-label="Select finding"
            data-testid="finding-select"
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
          >
            <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={severityOf(finding)} />
                {finding.cweId && (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {finding.cweId}
                  </Badge>
                )}
                <span className="text-sm font-medium">{finding.title}</span>
                {finding.status && <span className="text-xs text-muted-foreground">· {finding.status}</span>}
              </div>
              {location && <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{location}</p>}
              {!open && finding.description && (
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{finding.description}</p>
              )}
            </div>
          </button>
        </div>
        {open && (
          <div className="space-y-3 border-t px-3 py-3" data-testid="finding-detail">
            {finding.description && <p className="whitespace-pre-wrap text-sm">{finding.description}</p>}
            <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {Object.entries(finding.properties)
                .filter(([key]) => key !== "description")
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt className="truncate font-mono text-muted-foreground">{key}</dt>
                    <dd className="whitespace-pre-wrap break-words">{formatValue(value)}</dd>
                  </React.Fragment>
                ))}
              <dt className="truncate font-mono text-muted-foreground">ref_id</dt>
              <dd className="break-all font-mono">{finding.refId}</dd>
            </dl>
            <div className="border-t pt-3">
              <FindingVerify refId={finding.refId} version={checksVersion} onVerdict={onVerdict} />
            </div>
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-medium">Related nodes</p>
              <RelatedNodes refId={finding.refId} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The Infosec page's Findings tab: the workspace graph's `infosec` `Finding` nodes, most severe first. */
export function FindingsTab() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [data, setData] = useState<SystemMapFindingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<string | null>(null);
  const { canWrite } = useWorkspaceAccess();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Bumped when a batch check starts, so the open cards' check lists re-read.
  const [checksVersion, setChecksVersion] = useState(0);

  const load = useCallback(async (workspaceSlug: string, signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/findings`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as SystemMapFindingsResponse);
    } catch (error) {
      if (signal?.aborted) return;
      setData({ status: "error", error: error instanceof Error ? error.message : "Request failed" });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    void load(slug, controller.signal);
    return () => controller.abort();
  }, [slug, load]);

  const reload = useCallback(() => {
    // Quiet: keep the list (and the open card) on screen while it re-reads.
    if (slug) void load(slug, undefined, true);
  }, [slug, load]);

  const findings = useMemo(() => (data?.status === "ready" ? data.findings : []), [data]);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const finding of findings) out.set(severityOf(finding), (out.get(severityOf(finding)) ?? 0) + 1);
    return [...out.entries()];
  }, [findings]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return findings.filter(
      (finding) => (!severity || severityOf(finding) === severity) && (!query || matches(finding, query)),
    );
  }, [findings, search, severity]);

  const select = useCallback((refId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(refId);
      else next.delete(refId);
      return next;
    });
  }, []);
  const allShownSelected = visible.length > 0 && visible.every((f) => selected.has(f.refId));
  const toggleShown = () =>
    setSelected(allShownSelected ? new Set() : new Set(visible.slice(0, MAX_BATCH).map((f) => f.refId)));

  return (
    <div className="max-w-6xl space-y-4">
      <p className="text-sm text-muted-foreground">
        The <span className="font-mono">Finding</span> nodes in this workspace&apos;s knowledge graph (namespace{" "}
        <span className="font-mono">infosec</span>), most severe first.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !slug}
          onClick={() => slug && void load(slug)}
          data-testid="findings-reload"
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Reload
        </Button>
        {counts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" data-testid="findings-severity-filter">
            <Button
              variant={severity === null ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSeverity(null)}
            >
              All · {findings.length}
            </Button>
            {counts.map(([value, count]) => (
              <Button
                key={value}
                variant={severity === value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs capitalize"
                onClick={() => setSeverity(severity === value ? null : value)}
              >
                {value} · {count}
              </Button>
            ))}
          </div>
        )}
        <div className="relative ml-auto w-72 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by title, CWE, file…"
            className="h-8 pl-8 text-sm"
            data-testid="findings-search"
          />
        </div>
      </div>

      {!loading && data?.status === "ready" && visible.length > 0 && (
        <div className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
          <Checkbox
            checked={allShownSelected}
            onCheckedChange={toggleShown}
            aria-label="Select shown findings"
            data-testid="findings-select-shown"
          />
          {allShownSelected
            ? "Deselect all"
            : `Select ${visible.length > MAX_BATCH ? `first ${MAX_BATCH}` : "all"} shown`}
        </div>
      )}

      {selected.size > 0 && (
        <BatchVerifyBar
          slug={slug}
          selected={[...selected]}
          canWrite={canWrite}
          onClear={() => setSelected(new Set())}
          onStarted={() => setChecksVersion((v) => v + 1)}
        />
      )}

      {loading && (
        <Card data-testid="findings-loading">
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading findings…
          </CardContent>
        </Card>
      )}

      {!loading && data?.status === "error" && (
        <Card data-testid="findings-error">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Could not load findings: {data.error}
          </CardContent>
        </Card>
      )}

      {!loading && data?.status === "ready" && (
        <div className="flex flex-col gap-2" data-testid="findings-list">
          {data.truncated && (
            <p className="text-xs text-muted-foreground">Showing the first {findings.length} findings.</p>
          )}
          {visible.map((finding) => (
            <FindingCard
              key={finding.refId}
              finding={finding}
              selected={selected.has(finding.refId)}
              onSelect={(on) => select(finding.refId, on)}
              checksVersion={checksVersion}
              onVerdict={reload}
            />
          ))}
          {findings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No Finding nodes in this workspace&apos;s infosec namespace yet.
            </p>
          )}
          {findings.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing matches.</p>
          )}
        </div>
      )}
    </div>
  );
}
