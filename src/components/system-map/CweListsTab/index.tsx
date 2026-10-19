"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Play, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { CWE_LISTS, isUsableCwe } from "@/lib/system-map/cwe-lists";
import type { CweEntry, CweListMember, CweListResponse, CweMappingUsage, CweSearchResponse } from "@/types/system-map";
import { ComponentPicker } from "./ComponentPicker";
import { RelatedPanel } from "./RelatedPanel";

/** Most CWEs one CWE check run takes (`CWE_SCOPED_WORKFLOWS.cwe_check.max`). */
const MAX_CHECK_CWES = 50;

const LABEL = "CWE check";

const USAGE_STYLE: Record<CweMappingUsage, string> = {
  Allowed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "Allowed-with-Review": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Discouraged: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  Prohibited: "bg-destructive/10 text-destructive",
  Unknown: "bg-muted text-muted-foreground",
};

function CweTitle({ cwe, muted }: { cwe: CweEntry; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground">{cwe.id}</span>
      <span className={cn("min-w-0 truncate text-sm", muted ? "text-muted-foreground" : "font-medium")}>
        {cwe.name}
      </span>
      {cwe.abstraction && (
        <Badge variant="outline" className="rounded-md">
          {cwe.abstraction}
        </Badge>
      )}
      <Badge variant="secondary" className={cn("rounded-md font-medium", USAGE_STYLE[cwe.usage])}>
        {cwe.usage === "Allowed-with-Review" ? "Allowed with review" : cwe.usage}
      </Badge>
      {cwe.url && (
        <a
          href={cwe.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${cwe.id} on MITRE`}
          onClick={(event) => event.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

interface RowActions {
  canWrite: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  launching: string | null;
  onLaunch: (cweIds: string[]) => void;
}

/** The open half of a CWE row: its description and related catalogue nodes. */
function CweDetails({ cwe }: { cwe: CweEntry }) {
  return (
    <div className="space-y-3">
      {cwe.description && <p className="text-xs text-muted-foreground">{cwe.description}</p>}
      <RelatedPanel cwe={cwe} />
    </div>
  );
}

/**
 * A CWE the CWE check may target: opens on click to its related nodes, with
 * a checkbox for the batch and a button to check it alone.
 */
function UsableRow({ cwe, note, actions }: { cwe: CweEntry; note?: string; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const busy = actions.launching === cwe.id;
  return (
    <div className="rounded-md hover:bg-muted/30" data-testid="cwe-usable-row">
      <div className="flex items-start gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 text-muted-foreground"
          aria-expanded={open}
          aria-label={open ? `Close ${cwe.id}` : `Open ${cwe.id}`}
          data-testid="cwe-row-toggle"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {actions.canWrite && (
          <Checkbox
            className="mt-0.5"
            checked={actions.selected.has(cwe.id)}
            onCheckedChange={() => actions.onToggle(cwe.id)}
            aria-label={`Select ${cwe.id}`}
          />
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <CweTitle cwe={cwe} />
          {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
        </button>
        {actions.canWrite && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={actions.launching !== null}
            onClick={() => actions.onLaunch([cwe.id])}
            data-testid="cwe-run-cwe_check"
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            {LABEL}
          </Button>
        )}
      </div>
      {open && (
        <div className="px-2 pb-2 pl-9">
          <CweDetails cwe={cwe} />
        </div>
      )}
    </div>
  );
}

function MemberCard({ member, actions }: { member: CweListMember; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const categoryNote = member.category ? `in ${member.category.id} ${member.category.name}` : undefined;

  if (isUsableCwe(member.usage)) {
    return (
      <div className="rounded-lg border bg-card">
        <UsableRow cwe={member} note={categoryNote} actions={actions} />
      </div>
    );
  }

  const children = member.usableChildren;
  return (
    <div className="rounded-lg border border-dashed bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
      >
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <CweTitle cwe={member} muted />
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {categoryNote && `${categoryNote} · `}
            {member.childrenError
              ? `Could not read its children: ${member.childrenError}`
              : `${children.length} usable ${children.length === 1 ? "child" : "children"} through PARENT_OF`}
          </p>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t px-2 py-2 pl-8">
          <CweDetails cwe={member} />
          {member.usageRationale && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Why not directly: </span>
              {member.usageRationale}
            </p>
          )}
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Usable children
            </p>
            {children.length === 0 && !member.childrenError && (
              <p className="text-xs text-muted-foreground">No usable children within three levels.</p>
            )}
            {children.map((child) => (
              <UsableRow
                key={child.id}
                cwe={child}
                note={child.via.length > 0 ? `via ${child.via.join(" › ")}` : undefined}
                actions={actions}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A catalogue search hit: checkable when usable, otherwise shown with why not. */
function CatalogueResult({ cwe, actions }: { cwe: CweEntry; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  if (isUsableCwe(cwe.usage)) {
    return (
      <div className="rounded-lg border bg-card">
        <UsableRow cwe={cwe} note={cwe.kind !== "weakness" ? cwe.kind : undefined} actions={actions} />
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
      >
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <CweTitle cwe={cwe} muted />
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {cwe.kind !== "weakness" ? `${cwe.kind} · ` : ""}too abstract to check directly
          </p>
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t px-2 py-2 pl-8">
          <CweDetails cwe={cwe} />
          {cwe.usageRationale && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Why not directly: </span>
              {cwe.usageRationale}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type CatalogueState =
  | { query: string; status: "loading" }
  | { query: string; status: "ready"; results: CweEntry[] }
  | { query: string; status: "error"; error: string };

function matches(cwe: CweEntry, query: string): boolean {
  const number = query.replace(/^cwe-?/, "");
  return cwe.name.toLowerCase().includes(query) || (number !== "" && String(cwe.number).startsWith(number));
}

/**
 * The Infosec page's CWE lists tab: a curated CWE view from the shared
 * infosec graph's CWE catalogue, and the CWE check (`cwe_ids`) on one or
 * many usable entries. A started run links to its page in the org strut view.
 */
export function CweListsTab() {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const [listId, setListId] = useState(CWE_LISTS[0].value);
  const [data, setData] = useState<CweListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [launching, setLaunching] = useState<string | null>(null);
  const [components, setComponents] = useState<string[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null);

  const load = useCallback(async (workspaceSlug: string, view: string, signal?: AbortSignal) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/system-map/cwe-list?view=${encodeURIComponent(view)}`,
        {
          cache: "no-store",
          signal,
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as CweListResponse);
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
    void load(slug, listId, controller.signal);
    return () => controller.abort();
  }, [slug, listId, load]);

  const members = useMemo(() => (data?.status === "ready" ? data.members : []), [data]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((m) => matches(m, query) || m.usableChildren.some((c) => matches(c, query)));
  }, [members, search]);

  const stats = useMemo(() => {
    const direct = members.filter((m) => isUsableCwe(m.usage)).length;
    const viaChildren = new Set(members.flatMap((m) => m.usableChildren.map((c) => c.id))).size;
    return { total: members.length, direct, needChildren: members.length - direct, viaChildren };
  }, [members]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const launch = useCallback(
    async (cweIds: string[]) => {
      if (!slug || launching) return;
      setLaunching(cweIds.length === 1 ? cweIds[0] : "selection");
      const label = LABEL;
      try {
        const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow: "cwe_check",
            cweIds,
            ...(components.length > 0 ? { components } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          strutUrl?: string | null;
        };
        if (!response.ok) {
          const title =
            response.status === 409
              ? `A ${label} run is already in progress`
              : body.code === "workflow_missing"
                ? `${label} workflow is not on this strut yet`
                : `Could not start ${label}`;
          toast.error(title, { description: body.error });
          return;
        }
        const scope =
          components.length === 0
            ? ""
            : components.length === 1
              ? ` · ${components[0]}`
              : ` · ${components.length} components`;
        toast.success(`${label} started on ${cweIds.length === 1 ? cweIds[0] : `${cweIds.length} CWEs`}${scope}`, {
          action: body.strutUrl
            ? { label: "View run", onClick: () => window.open(body.strutUrl!, "_blank") }
            : undefined,
        });
        if (cweIds.length > 1) setSelected(new Set());
      } catch (error) {
        toast.error(`Could not start ${label}`, {
          description: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setLaunching(null);
      }
    },
    [slug, launching, components],
  );

  const searchCatalogue = useCallback(
    async (raw: string) => {
      const query = raw.trim();
      if (!slug || !query) return;
      setCatalogue({ query, status: "loading" });
      try {
        const response = await fetch(`/api/workspaces/${slug}/system-map/cwe-search?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as (CweSearchResponse & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error ?? `HTTP ${response.status}`);
        setCatalogue((current) =>
          current?.query !== query
            ? current
            : body.status === "ready"
              ? { query, status: "ready", results: body.results }
              : { query, status: "error", error: body.error },
        );
      } catch (error) {
        setCatalogue((current) =>
          current?.query !== query
            ? current
            : { query, status: "error", error: error instanceof Error ? error.message : "Request failed" },
        );
      }
    },
    [slug],
  );

  const actions: RowActions = { canWrite, selected, onToggle: toggle, launching, onLaunch: launch };
  const selectedIds = [...selected];

  return (
    <div className="max-w-6xl space-y-4">
      <p className="text-sm text-muted-foreground">
        A curated list from the shared infosec graph&apos;s CWE catalogue. Entries MITRE marks Discouraged or Prohibited
        are too abstract to review directly, so their usable children are listed under them. Run the CWE check on one or
        many CWEs, optionally scoped to some of the system map&apos;s components.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger className="w-64" data-testid="cwe-list-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CWE_LISTS.map((list) => (
              <SelectItem key={list.value} value={list.value}>
                {list.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !slug}
          onClick={() => slug && void load(slug, listId)}
          data-testid="cwe-list-reload"
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Reload
        </Button>
        {canWrite && <ComponentPicker slug={slug} value={components} onChange={setComponents} />}
        <div className="relative ml-auto w-72 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (!event.target.value.trim()) setCatalogue(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void searchCatalogue(search);
            }}
            placeholder="Filter by id or name, e.g. 862 — Enter searches all CWEs"
            className="h-8 pl-8 text-sm"
            data-testid="cwe-list-search"
          />
        </div>
      </div>

      {canWrite && selectedIds.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
          data-testid="cwe-selection-bar"
        >
          <span>
            {selectedIds.length} CWE{selectedIds.length === 1 ? "" : "s"} selected
          </span>
          <Button
            size="sm"
            disabled={launching !== null || selectedIds.length > MAX_CHECK_CWES}
            onClick={() => void launch(selectedIds)}
            data-testid="cwe-run-selection"
          >
            {launching === "selection" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            )}
            Run CWE check on {selectedIds.length}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {selectedIds.length > MAX_CHECK_CWES && (
            <span className="text-xs text-muted-foreground">One run takes at most {MAX_CHECK_CWES} CWEs.</span>
          )}
        </div>
      )}

      {loading && (
        <Card data-testid="cwe-list-loading">
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading {listId} and walking its children…
          </CardContent>
        </Card>
      )}

      {!loading && data?.status === "error" && (
        <Card data-testid="cwe-list-error">
          <CardContent className="py-8 text-sm text-muted-foreground">{data.error}</CardContent>
        </Card>
      )}

      {!loading && data?.status === "ready" && (
        <>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
            data-testid="cwe-list-stats"
          >
            <span className="font-medium text-foreground">{data.view.name}</span>
            <span>{stats.total} entries</span>
            <span className="text-emerald-700 dark:text-emerald-300">{stats.direct} usable directly</span>
            <span>{stats.needChildren} need children</span>
            <span className="text-emerald-700 dark:text-emerald-300">{stats.viaChildren} usable through children</span>
          </div>
          <div className="flex flex-col gap-2" data-testid="cwe-list-members">
            {visible.map((member) => (
              <MemberCard key={member.id} member={member} actions={actions} />
            ))}
            {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this list matches.</p>}
          </div>
        </>
      )}

      {search.trim() && (!catalogue || catalogue.query !== search.trim()) && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void searchCatalogue(search)}
          data-testid="cwe-catalogue-search"
        >
          <Search className="mr-1.5 h-3.5 w-3.5" /> Search all CWEs for &ldquo;{search.trim()}&rdquo;
        </Button>
      )}

      {catalogue && (
        <div className="space-y-2" data-testid="cwe-catalogue-results">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            All CWEs matching &ldquo;{catalogue.query}&rdquo;
          </p>
          {catalogue.status === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching the catalogue…
            </p>
          )}
          {catalogue.status === "error" && <p className="text-sm text-muted-foreground">{catalogue.error}</p>}
          {catalogue.status === "ready" && catalogue.results.length === 0 && (
            <p className="text-sm text-muted-foreground">No CWE matches.</p>
          )}
          {catalogue.status === "ready" &&
            catalogue.results.map((cwe) => <CatalogueResult key={cwe.refId} cwe={cwe} actions={actions} />)}
        </div>
      )}
    </div>
  );
}
