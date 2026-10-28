"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, Loader2, Play, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fallbackSecurityAuditClasses, type SecurityAuditClassInfo } from "@/lib/system-map/security-audit";
import { SystemMapRuns } from "@/components/system-map/SystemMapRuns";
import type { SystemMapRun } from "@/types/system-map";

const MAX_CALLS = 2000;

/** What a class is selected by: its Concept ref_id, or its name for built-in text. */
const classKey = (c: SecurityAuditClassInfo) => c.ref_id ?? c.name;

/** `owner/name` of a GitHub repository URL, or null. */
export function repoFullName(url: string): string | null {
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Default agent-call cap for `repoCount` repos. */
export function defaultMaxCalls(repoCount: number): number {
  return Math.min(MAX_CALLS, Math.max(50, repoCount * 60));
}

/**
 * The Infosec page's Security audit tab: launches the `swarm-security-hunt`
 * workflow on chosen repositories. Findings it writes (with Dry run off) show
 * in the Findings tab.
 */
export function SecurityAuditTab({ onShowFindings }: { onShowFindings?: () => void }) {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const repos = useMemo(
    () =>
      (workspace?.repositories ?? []).map((r) => repoFullName(r.repositoryUrl)).filter((r): r is string => r !== null),
    [workspace?.repositories],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [classes, setClasses] = useState<Set<string>>(() => new Set());
  const [dryRun, setDryRun] = useState(true);
  const [callsInput, setCallsInput] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [runsKey, setRunsKey] = useState(0);
  const [classInfos, setClassInfos] = useState<SecurityAuditClassInfo[]>(fallbackSecurityAuditClasses);
  // The selection emptied because its classes left the list when the live one loaded.
  const [staleSelection, setStaleSelection] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const classesRef = useRef(classes);
  classesRef.current = classes;
  const [latest, setLatest] = useState<SystemMapRun | null>(null);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(`/api/workspaces/${slug}/system-map/security-audit/classes`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { classes?: SecurityAuditClassInfo[] } | null) => {
        if (!body?.classes?.length) return;
        const keys = new Set(body.classes.map(classKey));
        const kept = [...classesRef.current].filter((k) => keys.has(k));
        if (classesRef.current.size > 0 && kept.length === 0) setStaleSelection(true);
        setClasses(new Set(kept));
        setClassInfos(body.classes);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [slug]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const defaultCalls = defaultMaxCalls(selected.size || 1);
  const callsValue = callsInput ?? String(defaultCalls);
  const calls = Number(callsValue);
  const callsValid = Number.isInteger(calls) && calls >= 1 && calls <= MAX_CALLS;
  const chosenClasses = useMemo(() => classInfos.filter((c) => classes.has(classKey(c))), [classInfos, classes]);
  const classCount = chosenClasses.length || classInfos.length;
  const blockedByStale = staleSelection && chosenClasses.length === 0 && !confirmAll;
  const estCalls = selected.size * classCount * 10;
  const estCost = (estCalls * 2) / 30;

  const launch = useCallback(async () => {
    if (!slug || launching || selected.size === 0 || !callsValid || blockedByStale) return;
    setLaunching(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: "security_audit",
          repos: [...selected],
          ...(chosenClasses.length > 0
            ? chosenClasses.every((c) => c.ref_id)
              ? { classIds: chosenClasses.map((c) => c.ref_id) }
              : { classes: chosenClasses.map((c) => c.name) }
            : {}),
          apply: !dryRun,
          maxAgentCalls: calls,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start the audit");
      toast.success("Security audit started");
      setRunsKey((k) => k + 1);
    } catch (error) {
      toast.error("Could not start the audit", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLaunching(false);
    }
  }, [slug, launching, selected, chosenClasses, dryRun, calls, callsValid, blockedByStale]);

  return (
    <div className="max-w-6xl space-y-4" data-testid="security-audit-tab">
      <p className="text-sm text-muted-foreground">
        Audits the chosen repositories for vulnerabilities by class. With Dry run off, the results are written as
        Findings.
      </p>
      <Card>
        <CardContent className="space-y-5 py-4">
          <div className="space-y-2">
            <Label>Repositories</Label>
            {repos.length === 0 && <p className="text-xs text-muted-foreground">This workspace has no repositories.</p>}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {repos.map((repo) => (
                <label key={repo} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.has(repo)}
                    onCheckedChange={() => toggle(selected, setSelected, repo)}
                    aria-label={`Select ${repo}`}
                    disabled={!canWrite}
                  />
                  <span className="font-mono text-xs">{repo}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Classes <span className="font-normal text-muted-foreground">(none selected = all)</span>
            </Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {classInfos.map((c) => (
                <div key={classKey(c)} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    id={`audit-class-${c.name}`}
                    className="mt-0.5"
                    checked={classes.has(classKey(c))}
                    onCheckedChange={() => {
                      toggle(classes, setClasses, classKey(c));
                      setStaleSelection(false);
                    }}
                    aria-label={`Class ${c.name}`}
                    disabled={!canWrite}
                  />
                  <div className="min-w-0">
                    <label htmlFor={`audit-class-${c.name}`}>{c.name}</label>
                    {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                  </div>
                  {c.hunt && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" aria-label={`What ${c.name} hunts`} className="text-muted-foreground">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 text-xs">
                        <p className="mb-1 font-medium">What it hunts</p>
                        {c.hunt}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              ))}
            </div>
            {staleSelection && chosenClasses.length === 0 && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs"
                data-testid="security-audit-stale-warning"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-1.5">
                  <p>The classes you picked are no longer listed, so the selection was cleared. Pick classes again.</p>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={confirmAll}
                      onCheckedChange={(v) => setConfirmAll(v === true)}
                      aria-label="Run all classes"
                    />
                    Run all classes instead
                  </label>
                </div>
              </div>
            )}
            {classInfos.some((c) => c.fallback) && (
              <p className="text-xs text-muted-foreground" data-testid="security-audit-fallback-note">
                Some descriptions are built-in text; the live ones could not be read.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch id="audit-dry-run" checked={dryRun} onCheckedChange={setDryRun} disabled={!canWrite} />
                <Label htmlFor="audit-dry-run">Dry run</Label>
              </div>
              <p className="max-w-xs text-xs text-muted-foreground">
                {dryRun ? "Nothing is written." : "Turned off: the run writes Findings to the graph."}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="audit-max-calls">Max agent calls</Label>
              <Input
                id="audit-max-calls"
                type="number"
                min={1}
                max={MAX_CALLS}
                className="h-8 w-28"
                value={callsValue}
                onChange={(e) => setCallsInput(e.target.value)}
                disabled={!canWrite}
              />
              <p className="text-xs text-muted-foreground">The run fails before hunting if the plan needs more.</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground" data-testid="security-audit-cost">
            Rough cost: 1 repo with 3 classes ≈ 30 agent calls ≈ $2.
            {selected.size > 0 && ` This selection ≈ ${estCalls} calls ≈ $${estCost.toFixed(0)}.`}
          </p>

          <Button
            onClick={() => void launch()}
            disabled={!canWrite || !slug || launching || selected.size === 0 || !callsValid || blockedByStale}
            data-testid="security-audit-launch"
          >
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Launch audit
          </Button>
        </CardContent>
      </Card>

      {latest?.status === "SUCCESS" && latest.apply === true && (
        <div
          className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
          data-testid="security-audit-findings-pointer"
        >
          <ShieldAlert className="h-4 w-4" />
          The last audit wrote Findings.
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onShowFindings}>
            View them in the Findings tab
          </Button>
        </div>
      )}

      <SystemMapRuns
        workflowKey="security_audit"
        compact
        refreshKey={runsKey}
        onRuns={(runs) => setLatest(runs[0] ?? null)}
      />
    </div>
  );
}
