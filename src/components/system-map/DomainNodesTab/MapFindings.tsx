"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ShieldAlert, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FindingVerify } from "@/components/system-map/FindingsTab/FindingVerify";
import type {
  SystemMapFinding,
  SystemMapFindingPathStep,
  SystemMapFindingRelated,
  SystemMapFindingRelatedResponse,
  SystemMapFindingsResponse,
} from "@/types/system-map";
import type { MapModel } from "./map-layout";
import {
  findingColor,
  findingSeverityRank,
  type FindingHighlight,
  type MapFindingIndex,
  type PathStep,
} from "./map-findings";

export type FindingsState =
  | { status: "loading" }
  | { status: "ready"; findings: SystemMapFinding[]; truncated: boolean }
  | { status: "error"; error: string };

/** The workspace's infosec findings, read once per mount (`enabled` defers it until the Map is open). */
export function useMapFindings(slug: string | undefined, enabled: boolean): FindingsState {
  const [state, setState] = useState<FindingsState>({ status: "loading" });
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!slug || !enabled || loaded.current === slug) return;
    loaded.current = slug;
    const controller = new AbortController();
    fetch(`/api/workspaces/${slug}/system-map/findings`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as SystemMapFindingsResponse;
        setState(
          body.status === "ready"
            ? { status: "ready", findings: body.findings, truncated: body.truncated }
            : { status: "error", error: body.error },
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        loaded.current = null;
        setState({ status: "error", error: error instanceof Error ? error.message : "Request failed" });
      });
    return () => controller.abort();
  }, [slug, enabled]);
  return state;
}

export type RelatedState =
  | { status: "loading" }
  | { status: "ready"; related: SystemMapFindingRelated[]; paths: SystemMapFindingPathStep[][] }
  | { status: "error"; error: string };

/** One finding's related nodes (one read per finding, kept for the session). */
export function useFindingRelated(slug: string | undefined, refId: string | null): RelatedState | null {
  const cache = useRef(new Map<string, RelatedState>());
  const [, bump] = useState(0);
  useEffect(() => {
    if (!slug || !refId || cache.current.has(refId)) return;
    cache.current.set(refId, { status: "loading" });
    bump((n) => n + 1);
    fetch(`/api/workspaces/${slug}/system-map/findings/related?refId=${encodeURIComponent(refId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as SystemMapFindingRelatedResponse;
        cache.current.set(
          refId,
          body.status === "ready"
            ? { status: "ready", related: body.related, paths: body.paths ?? [] }
            : { status: "error", error: body.error },
        );
      })
      .catch((error) => {
        cache.current.set(refId, { status: "error", error: error instanceof Error ? error.message : "Request failed" });
      })
      .finally(() => bump((n) => n + 1));
  }, [slug, refId]);
  return refId ? (cache.current.get(refId) ?? { status: "loading" }) : null;
}

export function FindingSeverity({ severity }: { severity: string | null }) {
  const color = findingColor(severity);
  return (
    <span
      className="shrink-0 rounded border px-1 text-[10px] font-medium capitalize"
      style={{ color, borderColor: `${color}80`, background: `${color}1a` }}
    >
      {severity ?? "unrated"}
    </span>
  );
}

function basename(path: string): string {
  return path.split("/").slice(-1)[0];
}

/**
 * The floating findings list on the Map: worst first, filterable by severity,
 * component and text. Picking one lights it on the map.
 */
export function MapFindingsList({
  state,
  index,
  model,
  selectedId,
  onSelect,
  component,
  onComponent,
}: {
  state: FindingsState;
  index: MapFindingIndex | null;
  model: MapModel;
  selectedId: string | null;
  onSelect: (refId: string | null) => void;
  /** Narrow the list to one component's findings (a badge click). */
  component: string | null;
  onComponent: (refId: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<string | null>(null);

  const findings = useMemo(() => (state.status === "ready" ? state.findings : []), [state]);
  const severities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of findings) counts.set(f.severity ?? "unrated", (counts.get(f.severity ?? "unrated") ?? 0) + 1);
    return [...counts].sort((a, b) => findingSeverityRank(a[0]) - findingSeverityRank(b[0]));
  }, [findings]);
  const componentOf = useCallback(
    (refId: string) =>
      index?.anchors.get(refId)?.find((id) => model.nodes.get(id)?.node.type === "SysComponent") ?? null,
    [index, model],
  );
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    const scoped = component ? (index?.byComponent.get(component) ?? []) : findings;
    return scoped.filter(
      (f) =>
        (!severity || (f.severity ?? "unrated") === severity) &&
        (!query || [f.title, f.cweId, f.file, f.status, f.refId].some((v) => v?.toLowerCase().includes(query))),
    );
  }, [findings, index, component, severity, search]);

  const count = state.status === "ready" ? findings.length : null;
  return (
    <div className="space-y-2 text-xs" data-testid="map-findings">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-left text-sm font-medium"
        aria-expanded={open}
        data-testid="map-findings-toggle"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        Findings
        {count !== null && <span className="font-normal text-muted-foreground">({count})</span>}
        {state.status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </button>
      {open && state.status === "error" && (
        <p className="text-muted-foreground" data-testid="map-findings-error">
          Could not load findings: {state.error}
        </p>
      )}
      {open && state.status === "ready" && findings.length === 0 && (
        <p className="text-muted-foreground">No findings in the infosec graph yet.</p>
      )}
      {open && findings.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1">
            {severities.map(([s, n]) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity((cur) => (cur === s ? null : s))}
                className={cn(
                  "rounded border px-1.5 py-0.5 capitalize",
                  severity === s ? "ring-1 ring-primary" : "opacity-80 hover:opacity-100",
                )}
                style={{ color: findingColor(s), borderColor: `${findingColor(s)}66` }}
                data-testid="map-findings-severity"
              >
                {n} {s}
              </button>
            ))}
          </div>
          {component && (
            <p className="flex items-center gap-1 text-muted-foreground">
              In <span className="font-medium text-foreground">{model.nodes.get(component)?.label ?? component}</span>
              <button
                type="button"
                onClick={() => onComponent(null)}
                aria-label="Show all findings"
                className="hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </p>
          )}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, CWE, file"
            className="h-7 text-xs"
            data-testid="map-findings-search"
          />
          <ul className="max-h-[min(50vh,28rem)] space-y-0.5 overflow-y-auto pr-1">
            {shown.map((f) => {
              const owner = componentOf(f.refId);
              return (
                <li key={f.refId}>
                  <button
                    type="button"
                    onClick={() => onSelect(selectedId === f.refId ? null : f.refId)}
                    className={cn(
                      "w-full rounded px-1.5 py-1 text-left hover:bg-muted/60",
                      selectedId === f.refId && "bg-muted ring-1 ring-primary",
                    )}
                    data-testid="map-finding"
                    data-ref-id={f.refId}
                  >
                    <span className="flex items-start gap-1.5">
                      <FindingSeverity severity={f.severity} />
                      <span className="min-w-0 flex-1 break-words leading-snug">{f.title}</span>
                    </span>
                    <span className="mt-0.5 block truncate pl-0.5 text-[10px] text-muted-foreground">
                      {[
                        f.cweId,
                        f.file ? `${basename(f.file)}${f.line ? `:${f.line}` : ""}` : null,
                        owner ? model.nodes.get(owner)?.label : "not on the map",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-1.5 text-muted-foreground">No findings match.</li>}
          </ul>
          {state.status === "ready" && state.truncated && (
            <p className="text-muted-foreground">More findings exist than this view loads.</p>
          )}
        </>
      )}
    </div>
  );
}

/** The detail panel for the finding lit on the map. */
export function MapFindingDetails({
  finding,
  highlight,
  related,
  model,
  paths,
  onLoadPackages,
  onOpen,
  onHover,
  onClose,
}: {
  finding: SystemMapFinding;
  highlight: FindingHighlight;
  related: RelatedState | null;
  model: MapModel;
  /** How the package it is about gets in, component first (a CVE finding). */
  paths: PathStep[][];
  /** Read the packages, for the chain a path without them cannot show. */
  onLoadPackages?: () => void;
  onOpen: (refId: string) => void;
  /** A step or node hovered here, to light on the map. */
  onHover: (refId: string | null) => void;
  onClose: () => void;
}) {
  // Packages show as the path, not as map items.
  const onMap = [...highlight.ids]
    .map((id) => {
      const n = model.nodes.get(id);
      return n ? { id, name: n.label, type: n.node.type.replace(/^Sys/, "") } : null;
    })
    .filter((x): x is { id: string; name: string; type: string } => x !== null)
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const inPath = new Set(paths.flat().map((step) => step.id));
  const offMap = highlight.offMap.filter((r) => !inPath.has(r.refId));
  const hover = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null) });
  return (
    <div className="space-y-3 text-xs" data-testid="map-finding-details">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <FindingSeverity severity={finding.severity} />
            {finding.cweId && <span className="font-mono text-muted-foreground">{finding.cweId}</span>}
            {finding.status && <span className="text-muted-foreground">· {finding.status}</span>}
          </p>
          <p className="break-words text-sm font-medium">{finding.title}</p>
          {finding.file && (
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              {finding.file}
              {finding.line ? `:${finding.line}` : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {finding.description && <p className="line-clamp-6 whitespace-pre-wrap">{finding.description}</p>}
      {paths.length > 0 && (
        <div data-testid="map-finding-paths">
          <p className="mb-1 font-medium">How it gets in</p>
          <ol className="space-y-1.5">
            {paths.map((path, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-1 gap-y-0.5" data-testid="map-finding-path">
                {path.map((step, j) => {
                  const last = j === path.length - 1;
                  const text = cn(
                    step.kind === "component" ? "font-medium" : "font-mono text-[11px]",
                    last && "text-red-600 dark:text-red-400",
                  );
                  return (
                    <React.Fragment key={step.id}>
                      {j > 0 && <span className="text-muted-foreground">→</span>}
                      {step.placed ? (
                        <button
                          type="button"
                          onClick={() => onOpen(step.id)}
                          {...hover(step.id)}
                          className={cn(
                            "rounded px-1 text-left hover:bg-muted",
                            text,
                            !last && "text-blue-600 dark:text-blue-400",
                          )}
                          data-testid="map-finding-path-step"
                        >
                          {step.label}
                        </button>
                      ) : (
                        <span className={cn("px-1", text)}>{step.label}</span>
                      )}
                    </React.Fragment>
                  );
                })}
              </li>
            ))}
          </ol>
          {onLoadPackages && paths.some((path) => path.some((step) => !step.placed)) && (
            <p className="mt-1 text-muted-foreground">
              The chain through other packages needs the packages read.{" "}
              <button
                type="button"
                onClick={onLoadPackages}
                className="text-blue-600 hover:underline dark:text-blue-400"
                data-testid="map-finding-load-packages"
              >
                Read packages
              </button>
            </p>
          )}
        </div>
      )}
      <div>
        <p className="mb-1 font-medium">On the map ({onMap.length})</p>
        {onMap.length === 0 ? (
          <p className="text-muted-foreground">
            {related?.status === "loading" ? "Reading related nodes…" : "Nothing on the map is linked to it."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {onMap.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => onOpen(x.id)}
                  {...hover(x.id)}
                  className="text-left text-blue-600 hover:underline dark:text-blue-400"
                >
                  {x.name}
                </button>{" "}
                <span className="text-muted-foreground">{x.type}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {related?.status === "error" && (
        <p className="text-muted-foreground">Could not read related nodes: {related.error}</p>
      )}
      {offMap.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Not on the map ({offMap.length})</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {offMap.map((r) => (
              <li key={`${r.refId}|${r.edgeType}|${r.direction}`} className="break-words">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {r.direction === "out" ? `${r.edgeType} →` : `← ${r.edgeType}`}
                </span>{" "}
                {r.name} <span className="text-muted-foreground">{r.nodeType}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <FindingVerify refId={finding.refId} />
    </div>
  );
}
