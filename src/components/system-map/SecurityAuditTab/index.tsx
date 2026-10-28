"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { cn } from "@/lib/utils";
import { fallbackSecurityAuditClasses, type SecurityAuditClassInfo } from "@/lib/system-map/security-audit";
import { SystemMapRuns } from "@/components/system-map/SystemMapRuns";
import type { SystemMapRun } from "@/types/system-map";

const MAX_CALLS = 2000;
/** The most repositories one audit takes (the runs route refuses more). */
export const MAX_AUDIT_REPOS = 50;
/** Above this many repositories the list gets a filter box. */
const REPO_FILTER_THRESHOLD = 8;

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

function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** A section heading with a tri-state "select all" checkbox and a count. */
function SectionHeader({
  id,
  label,
  hint,
  selected,
  total,
  onToggleAll,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  selected: number;
  total: number;
  onToggleAll: () => void;
  disabled: boolean;
}) {
  const all = total > 0 && selected === total;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b pb-2">
      <Checkbox
        id={id}
        checked={all ? true : selected > 0 ? "indeterminate" : false}
        onCheckedChange={onToggleAll}
        disabled={disabled || total === 0}
        aria-label={`Select all ${label.toLowerCase()}`}
        data-testid={id}
      />
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
      <span className="text-xs text-muted-foreground">
        {selected} of {total} selected
        {hint && ` · ${hint}`}
      </span>
    </div>
  );
}

function ClassRow({
  info,
  checked,
  onToggle,
  disabled,
}: {
  info: SecurityAuditClassInfo;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(info.description || info.hunt);
  const Chevron = open ? ChevronDown : ChevronRight;
  const id = `audit-class-${info.name}`;
  return (
    <div className={cn("rounded-md border px-2.5 py-2", checked && "border-primary/40 bg-primary/5")}>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Class ${info.name}`}
          disabled={disabled}
        />
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate">
          {info.name}
        </label>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details for ${info.name}`}
            className="flex items-center gap-0.5 rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            data-testid="security-audit-class-toggle"
          >
            {open ? "Less" : "Details"}
            <Chevron className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-6 text-xs text-muted-foreground" data-testid="security-audit-class-details">
          {info.description && <p className="whitespace-pre-wrap">{info.description}</p>}
          {info.hunt && (
            <div>
              <p className="mb-0.5 font-medium text-foreground">What it hunts</p>
              <p className="whitespace-pre-wrap">{info.hunt}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const [repoFilter, setRepoFilter] = useState("");
  // null: every class (the default); otherwise the chosen class keys.
  const [chosenClasses, setChosenClasses] = useState<Set<string> | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [callsInput, setCallsInput] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [runsKey, setRunsKey] = useState(0);
  const [classInfos, setClassInfos] = useState<SecurityAuditClassInfo[]>(fallbackSecurityAuditClasses);
  const [latest, setLatest] = useState<SystemMapRun | null>(null);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(`/api/workspaces/${slug}/system-map/security-audit/classes`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { classes?: SecurityAuditClassInfo[] } | null) => {
        if (body?.classes?.length) setClassInfos(body.classes);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [slug]);

  const classKeys = useMemo(() => classInfos.map(classKey), [classInfos]);
  // Chosen classes that are no longer offered (the live list replaced the built-in one) drop out.
  const classes = useMemo(
    () => (chosenClasses ? new Set(classKeys.filter((k) => chosenClasses.has(k))) : new Set(classKeys)),
    [chosenClasses, classKeys],
  );
  const chosenInfos = useMemo(() => classInfos.filter((c) => classes.has(classKey(c))), [classInfos, classes]);
  const allClasses = classes.size === classKeys.length;
  // Classes were picked, but none of them is listed any more.
  const staleSelection = chosenClasses !== null && chosenClasses.size > 0 && classes.size === 0;
  const toggleClass = (key: string) => setChosenClasses(toggled(classes, key));
  const toggleAllClasses = () => setChosenClasses(allClasses ? new Set() : null);

  const shownRepos = useMemo(() => {
    const q = repoFilter.trim().toLowerCase();
    return q ? repos.filter((r) => r.toLowerCase().includes(q)) : repos;
  }, [repos, repoFilter]);
  const allShownReposSelected = shownRepos.length > 0 && shownRepos.every((r) => selected.has(r));
  const toggleAllRepos = () => {
    const next = new Set(selected);
    if (allShownReposSelected) shownRepos.forEach((r) => next.delete(r));
    else shownRepos.forEach((r) => next.add(r));
    setSelected(next);
  };
  const tooManyRepos = selected.size > MAX_AUDIT_REPOS;

  const defaultCalls = defaultMaxCalls(selected.size || 1);
  const callsValue = callsInput ?? String(defaultCalls);
  const calls = Number(callsValue);
  const callsValid = Number.isInteger(calls) && calls >= 1 && calls <= MAX_CALLS;
  const estCalls = selected.size * classes.size * 10;
  const estCost = (estCalls * 2) / 30;

  const launch = useCallback(async () => {
    if (!slug || launching || selected.size === 0 || classes.size === 0 || tooManyRepos || !callsValid) return;
    setLaunching(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: "security_audit",
          repos: [...selected],
          // Every class is the workflow's default; send the list only when narrowed.
          ...(allClasses
            ? {}
            : chosenInfos.every((c) => c.ref_id)
              ? { classIds: chosenInfos.map((c) => c.ref_id) }
              : { classes: chosenInfos.map((c) => c.name) }),
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
  }, [slug, launching, selected, classes, chosenInfos, allClasses, tooManyRepos, dryRun, calls, callsValid]);

  const blocker = !canWrite
    ? "Developer access required"
    : selected.size === 0
      ? "Pick at least one repository"
      : tooManyRepos
        ? `At most ${MAX_AUDIT_REPOS} repositories per audit`
        : staleSelection
          ? "The classes you picked are no longer listed"
          : classes.size === 0
            ? "Pick at least one class"
            : !callsValid
              ? `Max agent calls must be 1–${MAX_CALLS}`
              : null;

  return (
    <div className="max-w-6xl space-y-4" data-testid="security-audit-tab">
      <p className="text-sm text-muted-foreground">
        Audits the chosen repositories for vulnerabilities by class. With Dry run off, the results are written as
        Findings.
      </p>
      <Card>
        <CardContent className="space-y-5 py-4">
          <div className="space-y-2">
            <SectionHeader
              id="security-audit-repos-all"
              label="Repositories"
              selected={selected.size}
              total={repos.length}
              onToggleAll={toggleAllRepos}
              disabled={!canWrite}
            />
            {repos.length === 0 && <p className="text-xs text-muted-foreground">This workspace has no repositories.</p>}
            {repos.length > REPO_FILTER_THRESHOLD && (
              <div className="relative w-72 max-w-full">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={repoFilter}
                  onChange={(e) => setRepoFilter(e.target.value)}
                  placeholder="Filter repositories…"
                  className="h-8 pl-8 text-sm"
                  data-testid="security-audit-repo-filter"
                />
              </div>
            )}
            <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {shownRepos.map((repo) => (
                <label key={repo} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.has(repo)}
                    onCheckedChange={() => setSelected(toggled(selected, repo))}
                    aria-label={`Select ${repo}`}
                    disabled={!canWrite}
                  />
                  <span className="font-mono text-xs">{repo}</span>
                </label>
              ))}
              {repos.length > 0 && shownRepos.length === 0 && (
                <p className="text-xs text-muted-foreground">No repository matches.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeader
              id="security-audit-classes-all"
              label="Classes"
              hint={allClasses ? "all classes are hunted" : undefined}
              selected={classes.size}
              total={classKeys.length}
              onToggleAll={toggleAllClasses}
              disabled={!canWrite}
            />
            <div className="grid items-start gap-1.5 sm:grid-cols-2">
              {classInfos.map((c) => (
                <ClassRow
                  key={classKey(c)}
                  info={c}
                  checked={classes.has(classKey(c))}
                  onToggle={() => toggleClass(classKey(c))}
                  disabled={!canWrite}
                />
              ))}
            </div>
            {staleSelection && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs"
                data-testid="security-audit-stale-warning"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-1.5">
                  <p>The classes you picked are no longer listed, so the selection was cleared. Pick classes again.</p>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={false}
                      onCheckedChange={() => setChosenClasses(null)}
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

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              onClick={() => void launch()}
              disabled={!slug || launching || blocker !== null}
              data-testid="security-audit-launch"
            >
              {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {dryRun ? "Launch dry run" : "Launch audit"}
            </Button>
            <div className="text-xs text-muted-foreground" data-testid="security-audit-cost">
              {blocker ? (
                <p>{blocker}.</p>
              ) : (
                <p>
                  {selected.size} repo{selected.size === 1 ? "" : "s"} ×{" "}
                  {allClasses ? `all ${classes.size}` : classes.size} class{classes.size === 1 ? "" : "es"} ≈ {estCalls}{" "}
                  agent calls ≈ ${estCost.toFixed(0)}
                  {dryRun ? " · dry run, nothing is written" : " · writes Findings"}
                </p>
              )}
              <p>Rough cost: 1 repo with 3 classes ≈ 30 agent calls ≈ $2.</p>
            </div>
          </div>
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
