"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { toast } from "sonner";
import { fixDisabledReason, isActiveFixStatus, MAX_FIX_BATCH } from "@/lib/system-map/finding-fix";
import type { SystemMapFinding, SystemMapFindingFix, SystemMapFindingsResponse } from "@/types/system-map";
import { FixBadge, FixButton } from "./FindingFixStatus";
import { RelatedNodes } from "./RelatedNodes";
import { FindingVerify } from "./FindingVerify";
import { BatchVerifyBar, MAX_BATCH } from "./BatchVerifyBar";
import { CHECK_LABEL, summarizeFinding, type FindingCheck, type FindingSummary } from "./finding-kind";

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

const MAX_IDS_SHOWN = 3;

function matches(finding: SystemMapFinding, summary: FindingSummary, query: string): boolean {
  return [
    finding.title,
    finding.cweId,
    finding.file,
    finding.status,
    finding.description,
    finding.refId,
    summary.pkg,
    ...summary.ids,
  ].some((v) => v?.toLowerCase().includes(query));
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
  summary,
  selected,
  onSelect,
  checksVersion,
  onVerdict,
  fix,
  canFix,
  fixing,
  onFix,
}: {
  finding: SystemMapFinding;
  summary: FindingSummary;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  checksVersion: number;
  onVerdict: () => void;
  fix: SystemMapFindingFix | undefined;
  canFix: boolean;
  fixing: boolean;
  onFix: () => void;
}) {
  const [open, setOpen] = useState(false);
  const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : null;
  const Chevron = open ? ChevronDown : ChevronRight;
  const isCve = summary.check === "cve";
  const extraIds = summary.ids.length - MAX_IDS_SHOWN;

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
                {summary.ids.slice(0, MAX_IDS_SHOWN).map((id) => (
                  <Badge key={id} variant="secondary" className="font-mono text-[11px]">
                    {id}
                  </Badge>
                ))}
                {extraIds > 0 && <span className="text-[11px] text-muted-foreground">+{extraIds}</span>}
                <span className="text-sm font-medium">{finding.title}</span>
                {finding.status && <span className="text-xs text-muted-foreground">· {finding.status}</span>}
              </div>
              {isCve && summary.pkg ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" data-testid="finding-package">
                  <span className="font-mono text-foreground/80">{summary.pkg}</span>
                  {summary.fixedIn && (
                    <>
                      {" "}
                      · fixed in <span className="font-mono">{summary.fixedIn}</span>
                    </>
                  )}
                  {location && <span className="font-mono"> · {location}</span>}
                </p>
              ) : (
                location && <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{location}</p>
              )}
              {!open && finding.description && (
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{finding.description}</p>
              )}
              {fix && (
                <div className="mt-1">
                  <FixBadge fix={fix} />
                </div>
              )}
            </div>
          </button>
          <div className="mr-3 mt-2">
            <FixButton
              disabledReason={canFix ? fixDisabledReason(finding, fix) : "Developer access required"}
              busy={fixing}
              onClick={onFix}
            />
          </div>
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
  const [check, setCheck] = useState<FindingCheck>("cwe");
  const { canWrite } = useWorkspaceAccess();
  const [fixes, setFixes] = useState<Map<string, SystemMapFindingFix>>(() => new Map());
  const [fixingRefs, setFixingRefs] = useState<Set<string>>(() => new Set());
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

  const loadFixes = useCallback(async (workspaceSlug: string) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}/system-map/findings/fix`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { fixes: SystemMapFindingFix[] };
      setFixes(new Map(body.fixes.map((f) => [f.findingRefId, f])));
    } catch {
      // Fix status is secondary; the list still works without it.
    }
  }, []);

  const anyActiveFix = useMemo(() => [...fixes.values()].some((f) => isActiveFixStatus(f.status)), [fixes]);
  useEffect(() => {
    if (slug) void loadFixes(slug);
  }, [slug, loadFixes]);
  useEffect(() => {
    if (!slug || !anyActiveFix) return;
    const timer = setInterval(() => void loadFixes(slug), 10_000);
    return () => clearInterval(timer);
  }, [slug, anyActiveFix, loadFixes]);

  const startFixes = useCallback(
    async (refIds: string[]) => {
      if (!slug) return;
      setFixingRefs((prev) => new Set([...prev, ...refIds]));
      try {
        const response = await fetch(`/api/workspaces/${slug}/system-map/findings/fix`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refIds }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          started?: unknown[];
          refused?: { reason: string }[];
        };
        if (!response.ok) throw new Error(body.error || "Could not start the fix");
        const refused = body.refused?.length ?? 0;
        toast.success(`Started ${body.started?.length ?? 0} fix${body.started?.length === 1 ? "" : "es"}`, {
          description: refused ? `${refused} skipped: ${body.refused?.[0]?.reason}` : undefined,
        });
        setSelected(new Set());
      } catch (error) {
        toast.error("Could not start the fix", {
          description: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setFixingRefs((prev) => {
          const next = new Set(prev);
          refIds.forEach((id) => next.delete(id));
          return next;
        });
        await loadFixes(slug);
      }
    },
    [slug, loadFixes],
  );

  const findings = useMemo(() => (data?.status === "ready" ? data.findings : []), [data]);
  const summaries = useMemo(() => new Map(findings.map((f) => [f.refId, summarizeFinding(f)])), [findings]);

  const byCheck = useMemo(() => {
    const out: Record<FindingCheck, SystemMapFinding[]> = { cwe: [], cve: [] };
    for (const finding of findings) out[summaries.get(finding.refId)!.check].push(finding);
    return out;
  }, [findings, summaries]);
  const checkFindings = byCheck[check];

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const finding of checkFindings) out.set(severityOf(finding), (out.get(severityOf(finding)) ?? 0) + 1);
    return [...out.entries()];
  }, [checkFindings]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return checkFindings.filter(
      (finding) =>
        (!severity || severityOf(finding) === severity) &&
        (!query || matches(finding, summaries.get(finding.refId)!, query)),
    );
  }, [checkFindings, summaries, search, severity]);

  const switchCheck = (next: string) => {
    setCheck(next as FindingCheck);
    setSeverity(null);
    setSelected(new Set());
  };

  const select = useCallback((refId: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(refId);
      else next.delete(refId);
      return next;
    });
  }, []);
  const selectedList = useMemo(() => [...selected], [selected]);
  const fixBatchReason = useMemo(() => {
    if (!canWrite) return "Developer access required";
    if (selectedList.length > MAX_FIX_BATCH) return `At most ${MAX_FIX_BATCH} findings can be fixed at once`;
    const byRef = new Map(findings.map((f) => [f.refId, f]));
    for (const id of selectedList) {
      const finding = byRef.get(id);
      const reason = finding ? fixDisabledReason(finding, fixes.get(id)) : "Finding not found";
      if (reason) return `${finding?.title ?? id}: ${reason}`;
    }
    return null;
  }, [canWrite, selectedList, findings, fixes]);
  const allShownSelected = visible.length > 0 && visible.every((f) => selected.has(f.refId));
  const toggleShown = () =>
    setSelected(allShownSelected ? new Set() : new Set(visible.slice(0, MAX_BATCH).map((f) => f.refId)));

  return (
    <div className="max-w-6xl space-y-4">
      <p className="text-sm text-muted-foreground">
        The <span className="font-mono">Finding</span> nodes in this workspace&apos;s knowledge graph (namespace{" "}
        <span className="font-mono">infosec</span>), most severe first.
      </p>

      <Tabs value={check} onValueChange={switchCheck}>
        <TabsList data-testid="findings-check-tabs">
          {(["cwe", "cve"] as const).map((value) => (
            <TabsTrigger key={value} value={value} data-testid={`findings-check-${value}`}>
              {CHECK_LABEL[value]}
              {data?.status === "ready" && (
                <span className="ml-1.5 text-xs text-muted-foreground">{byCheck[value].length}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
              All · {checkFindings.length}
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
            placeholder={check === "cve" ? "Filter by title, CVE, package…" : "Filter by title, CWE, file…"}
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
          fixDisabledReason={fixBatchReason}
          fixing={selectedList.some((id) => fixingRefs.has(id))}
          onFix={() => void startFixes(selectedList)}
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
              summary={summaries.get(finding.refId)!}
              selected={selected.has(finding.refId)}
              onSelect={(on) => select(finding.refId, on)}
              checksVersion={checksVersion}
              onVerdict={reload}
              fix={fixes.get(finding.refId)}
              canFix={canWrite}
              fixing={fixingRefs.has(finding.refId)}
              onFix={() => void startFixes([finding.refId])}
            />
          ))}
          {findings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No Finding nodes in this workspace&apos;s infosec namespace yet.
            </p>
          )}
          {findings.length > 0 && checkFindings.length === 0 && (
            <p className="text-sm text-muted-foreground">No findings from the {CHECK_LABEL[check]} yet.</p>
          )}
          {checkFindings.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing matches.</p>
          )}
        </div>
      )}
    </div>
  );
}
