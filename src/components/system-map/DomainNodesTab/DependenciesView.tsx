"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SystemMapDomainNode } from "@/types/system-map";
import { whyChain, type DependencyModel, type PackageRow } from "./dependencies";
import { NodeLink, PropertyList } from "./NodeDetails";

type Filter = "all" | "direct" | "multi" | `source:${string}`;
type SortKey = "name" | "version" | "ecosystem" | "usedBy" | "dependsOn" | "pullsIn";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Package" },
  { key: "version", label: "Version" },
  { key: "ecosystem", label: "Ecosystem" },
  { key: "usedBy", label: "Used by", numeric: true },
  { key: "dependsOn", label: "Depends on", numeric: true },
  { key: "pullsIn", label: "Pulls in (all)", numeric: true },
];

function Tile({
  value,
  label,
  active,
  onClick,
  title,
}: {
  value: number;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "min-w-28 rounded-lg border bg-background px-3 py-2 text-left hover:bg-muted/50",
        active && "ring-2 ring-primary",
      )}
      data-testid="deps-tile"
    >
      <p className="text-lg font-semibold leading-tight">{value}</p>
      <p className="max-w-48 truncate text-[11px] text-muted-foreground">{label}</p>
    </button>
  );
}

function PackageList({
  ids,
  model,
  onOpen,
}: {
  ids: string[];
  model: DependencyModel;
  onOpen: (refId: string) => void;
}) {
  const rows = ids
    .map((id) => model.byRef.get(id))
    .filter((r): r is PackageRow => !!r)
    .sort((a, b) => a.node.name.localeCompare(b.node.name));
  if (rows.length === 0) return <p className="text-muted-foreground">None</p>;
  return (
    <ul className="space-y-0.5">
      {rows.map((r) => (
        <li key={r.node.refId}>
          <NodeLink node={r.node} onOpen={onOpen} /> <span className="text-muted-foreground">{r.version}</span>
        </li>
      ))}
    </ul>
  );
}

/** The side panel for one package: why it is here, its other versions, what it uses and what uses it. */
export function PackageDetails({
  row,
  model,
  byRef,
  reach,
  onOpen,
  onClose,
}: {
  row: PackageRow;
  model: DependencyModel;
  byRef: Map<string, SystemMapDomainNode>;
  reach: (refId: string) => number;
  onOpen: (refId: string) => void;
  onClose: () => void;
}) {
  const chain = whyChain(model, row.node.refId);
  const others = model.packages.filter((p) => p.node.name === row.node.name && p.node.refId !== row.node.refId);
  return (
    <div className="space-y-3 text-xs" data-testid="deps-detail">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">
            {row.node.name} <span className="font-normal text-muted-foreground">{row.version}</span>
          </p>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {typeof row.node.properties.id === "string" ? row.node.properties.id : row.ecosystem}
          </p>
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
      <div>
        <p className="mb-1 font-medium">Why is it here?</p>
        {chain ? (
          <p className="flex flex-wrap items-center gap-1" data-testid="deps-why">
            {chain.map((id, i) => (
              <React.Fragment key={id}>
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <NodeLink node={model.byRef.get(id)!.node} onOpen={onOpen} />
              </React.Fragment>
            ))}
            {chain.length === 1 && <span className="text-muted-foreground">(direct)</span>}
          </p>
        ) : (
          <p className="text-muted-foreground">No chain from a direct package.</p>
        )}
      </div>
      {others.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-amber-700 dark:text-amber-400">
            Other versions in the graph ({others.length})
          </p>
          <PackageList ids={others.map((o) => o.node.refId)} model={model} onOpen={onOpen} />
        </div>
      )}
      <div>
        <p className="mb-1 font-medium">Used by ({row.usedBy.length})</p>
        <PackageList ids={row.usedBy} model={model} onOpen={onOpen} />
      </div>
      <div>
        <p className="mb-1 font-medium">
          Depends on ({row.dependsOn.length}) · pulls in {reach(row.node.refId)} in all
        </p>
        <PackageList ids={row.dependsOn} model={model} onOpen={onOpen} />
      </div>
      {row.declaredBy.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Declared by</p>
          {row.declaredBy.map((d) => (
            <p key={`${d.refId}-${d.edgeType}`}>
              {byRef.get(d.refId) && <NodeLink node={byRef.get(d.refId)!} onOpen={onOpen} />}{" "}
              <span className="font-mono text-[10px] text-muted-foreground">{d.edgeType}</span>
            </p>
          ))}
        </div>
      )}
      <div>
        <p className="mb-1 font-medium">Properties</p>
        <PropertyList node={row.node} />
      </div>
    </div>
  );
}

/** The Dependencies view: the packages as a filterable, sortable table instead of ~1,900 edges. */
export function DependenciesView({
  model,
  reach,
  selectedId,
  onSelect,
}: {
  model: DependencyModel;
  reach: (refId: string) => number;
  selectedId: string | null;
  onSelect: (refId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "usedBy", dir: -1 });

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const value: Record<SortKey, (r: PackageRow) => string | number> = {
      name: (r) => r.node.name,
      version: (r) => r.version,
      ecosystem: (r) => r.ecosystem,
      usedBy: (r) => r.usedBy.length,
      dependsOn: (r) => r.dependsOn.length,
      pullsIn: (r) => reach(r.node.refId),
    };
    return model.packages
      .filter(
        (r) =>
          (filter === "all" ||
            (filter === "direct" && r.direct) ||
            (filter === "multi" && r.versions > 1) ||
            (filter.startsWith("source:") && r.source === filter.slice(7))) &&
          (!query ||
            r.node.name.toLowerCase().includes(query) ||
            String(r.node.properties.id ?? "")
              .toLowerCase()
              .includes(query)),
      )
      .sort((a, b) => {
        const x = value[sort.key](a);
        const y = value[sort.key](b);
        const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return order * sort.dir || a.node.name.localeCompare(b.node.name);
      });
  }, [model.packages, filter, search, sort, reach]);

  // A file's name, or its folder and name when two sources share the name (two Package.resolved).
  const sourceLabels = useMemo(() => {
    const name = (path: string) => path.split("/").slice(-1).join("/");
    const counts = new Map<string, number>();
    for (const s of model.sources) counts.set(name(s.source), (counts.get(name(s.source)) ?? 0) + 1);
    return new Map(
      model.sources.map((s) => [
        s.source,
        (counts.get(name(s.source)) ?? 0) > 1 ? s.source.split("/").slice(-2).join("/") : name(s.source),
      ]),
    );
  }, [model.sources]);

  const toggleFilter = (next: Filter) => setFilter((current) => (current === next ? "all" : next));
  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }));

  if (model.packages.length === 0) {
    return <p className="text-sm text-muted-foreground">No packages in this workspace&apos;s System Map.</p>;
  }

  return (
    <div className="space-y-3" data-testid="system-map-dependencies">
      <div className="flex flex-wrap gap-2">
        <Tile
          value={model.packages.length}
          label="packages"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <Tile
          value={model.directCount}
          label="direct (nothing depends on them)"
          active={filter === "direct"}
          onClick={() => toggleFilter("direct")}
        />
        <Tile
          value={model.multiVersionNames}
          label="names with several versions"
          active={filter === "multi"}
          onClick={() => toggleFilter("multi")}
        />
        {model.sources.map((s) => (
          <Tile
            key={s.source}
            value={s.count}
            label={sourceLabels.get(s.source) ?? s.source}
            title={s.source}
            active={filter === `source:${s.source}`}
            onClick={() => toggleFilter(`source:${s.source}`)}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search packages, e.g. tokio"
          className="h-8 max-w-xs text-sm"
          data-testid="deps-search"
        />
        <p className="text-xs text-muted-foreground" data-testid="deps-count">
          {rows.length} shown
        </p>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-[1] bg-background">
            <TableRow>
              {COLUMNS.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn("cursor-pointer select-none whitespace-nowrap", c.numeric && "text-right")}
                  onClick={() => sortBy(c.key)}
                >
                  {c.label}
                  {sort.key === c.key &&
                    (sort.dir === 1 ? (
                      <ArrowUp className="ml-1 inline h-3 w-3" />
                    ) : (
                      <ArrowDown className="ml-1 inline h-3 w-3" />
                    ))}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.node.refId}
                className={cn("cursor-pointer", selectedId === r.node.refId && "bg-muted")}
                onClick={() => onSelect(r.node.refId)}
                data-testid="deps-row"
              >
                <TableCell className="py-1.5">
                  {r.node.name}
                  {r.direct && (
                    <span className="ml-1.5 rounded border border-blue-500/40 px-1 text-[10px] text-blue-600 dark:text-blue-400">
                      direct
                    </span>
                  )}
                  {r.versions > 1 && (
                    <span className="ml-1.5 rounded border border-amber-500/50 px-1 text-[10px] text-amber-700 dark:text-amber-400">
                      ×{r.versions}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 font-mono text-xs">{r.version || "—"}</TableCell>
                <TableCell className="py-1.5 text-xs text-muted-foreground">{r.ecosystem || "—"}</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">
                  {r.usedBy.length}
                  <span
                    className="ml-1.5 inline-block h-1.5 rounded bg-primary/50 align-middle"
                    style={{ width: `${model.maxUsedBy ? Math.round((r.usedBy.length / model.maxUsedBy) * 48) : 0}px` }}
                  />
                </TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">{r.dependsOn.length}</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">{reach(r.node.refId)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
