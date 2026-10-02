"use client";

import React, { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import type { GraphSearchHit } from "@/types/graph-node";
import { health, pathToRoot, type WorkbenchGraph } from "./model";
import { nodeSearchQuery, nodeTypesQuery } from "./queries";
import { useWorkbench } from "./store";

/** "Glimmer (gRLM) › Coding" — where a node sits, without the node itself. */
function PathLabel({ graph, id }: { graph: WorkbenchGraph; id: string }) {
  const above = (pathToRoot(graph, id) ?? [id]).slice(0, -1);
  return (
    <span className="truncate text-[11px] text-muted-foreground">
      {above.length
        ? above.map((p) => graph.nodes[p]?.name).join(" › ")
        : graph.nodes[id]?.root
          ? "Root"
          : "Not in any tree"}
    </span>
  );
}

/** A crumb of the toolbar's path: a quiet button showing a value, opening a menu to pick another. */
function Crumb({ className, children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("min-w-0 shrink gap-1 px-2 font-normal has-[>svg]:px-2 data-[state=open]:bg-accent", className)}
      {...props}
    >
      {children}
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </Button>
  );
}

const Slash = () => (
  <span className="select-none px-0.5 text-sm text-muted-foreground/50" aria-hidden>
    /
  </span>
);

interface PickerItem {
  key: string;
  label: string;
  /** Muted, at the row's end: a count. */
  hint?: string | number;
}

/** One crumb of the path, picking from a headed list. The path shows only the value; `label` names it. */
export function Picker({
  label,
  value,
  selected,
  onSelect,
  heading,
  note,
  empty,
  items,
  width = "w-64",
  testId,
}: {
  label: string;
  value: string;
  selected: string | null;
  onSelect: (key: string) => void;
  heading: string;
  /** A line under the heading saying what the choices are. */
  note?: string;
  /** Shown when there are no choices. */
  empty?: string;
  items: PickerItem[];
  width?: string;
  testId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Crumb title={label} aria-label={`${label}: ${value}`} data-testid={testId}>
          <span className="max-w-40 truncate">{value}</span>
        </Crumb>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("max-h-80 overflow-y-auto", width)}>
        {note ? (
          <DropdownMenuLabel className="space-y-0.5 font-normal">
            <span className="block text-xs font-medium">{heading}</span>
            <span className="block text-[11px] text-muted-foreground">{note}</span>
          </DropdownMenuLabel>
        ) : (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        {items.length === 0 && empty && <p className="px-2 py-1.5 text-xs text-muted-foreground">{empty}</p>}
        <DropdownMenuRadioGroup value={selected ?? ""} onValueChange={onSelect}>
          {items.map((item) => (
            <DropdownMenuRadioItem key={item.key} value={item.key} className="gap-3">
              <span className="truncate">{item.label}</span>
              {item.hint !== undefined && (
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{item.hint}</span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Which trees to draw: nodes of one type, and the edge that runs from parent
 * to child. One menu, because together they are one choice.
 */
function LensPicker() {
  const { slug, lens, setLens, graph } = useWorkbench();
  const { data: types = [lens.type] } = useQuery(nodeTypesQuery(slug));
  const edges = graph?.edgeTypes ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Crumb
          className="shrink-0"
          title="Node type and edge"
          aria-label={`Trees of ${lens.type} along ${lens.edge}`}
          data-testid="graph-workbench-lens"
        >
          <span>{lens.type}</span>
          <span className="text-muted-foreground">by</span>
          <span className="font-mono text-xs">{lens.edge}</span>
        </Crumb>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="grid w-[440px] grid-cols-2 p-0">
        <div className="max-h-80 overflow-y-auto border-r p-1">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Node type</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={lens.type} onValueChange={(type) => setLens({ type })}>
            {types.map((t) => (
              <DropdownMenuRadioItem key={t} value={t}>
                <span className="truncate">{t}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Edge from parent to child
          </DropdownMenuLabel>
          {edges.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No edges between {lens.type} nodes</p>
          )}
          <DropdownMenuRadioGroup value={lens.edge} onValueChange={(edge) => setLens({ edge })}>
            {edges.map((e) => (
              <DropdownMenuRadioItem key={e.type} value={e.type} className="gap-3">
                <span className="truncate font-mono text-xs">{e.type}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{e.count}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Which tree to look at, by its root. A root is inferred, not stored: a node with children and no parent. */
function RootPicker({ graph }: { graph: WorkbenchGraph }) {
  const { roots, rootId, focusNode } = useWorkbench();
  return (
    <Picker
      label="Root"
      value={(rootId && graph.nodes[rootId]?.name) || "No root"}
      selected={rootId}
      onSelect={focusNode}
      heading="Roots"
      note={`${graph.lens.type} nodes with children and no parent along ${graph.lens.edge}. Pick one to see its tree.`}
      empty="No trees along this edge"
      width="w-72"
      items={roots.map(({ node, size }) => ({ key: node.id, label: node.name, hint: size }))}
      testId="graph-workbench-root"
    />
  );
}

const SEARCH_LIMIT = 20;
const NO_HITS: GraphSearchHit[] = [];

/** Nodes of the current type whose name or description matches — instant, and always openable on the tree. */
function searchLoaded(graph: WorkbenchGraph, query: string): GraphSearchHit[] {
  const q = query.toLowerCase();
  const rank = (name: string, description: string | null) =>
    name.toLowerCase().startsWith(q)
      ? 0
      : name.toLowerCase().includes(q)
        ? 1
        : description?.toLowerCase().includes(q)
          ? 2
          : 3;
  return Object.values(graph.nodes)
    .map((n) => ({ n, r: rank(n.name, n.description) }))
    .filter(({ r }) => r < 3)
    .sort((a, b) => a.r - b.r || a.n.name.localeCompare(b.n.name))
    .slice(0, SEARCH_LIMIT)
    .map(({ n }) => ({ ref_id: n.id, node_type: n.type, name: n.name, description: n.description ?? "" }));
}

/**
 * Search the current node type. Its nodes are all loaded, so matching is
 * local and every hit opens on the tree — unless the read was cut short, when
 * the swarm's search fills in. Picking a hit centres the canvas on it.
 */
function GraphSearch({ graph }: { graph: WorkbenchGraph }) {
  const { slug, focusNode, truncated } = useWorkbench();
  const type = graph.lens.type;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useDebounce(q.trim(), 250);
  const askSwarm = truncated && !!q.trim();
  const { data, isFetching } = useQuery({
    ...nodeSearchQuery(slug, type, settled, SEARCH_LIMIT),
    enabled: askSwarm && !!settled,
  });
  const remote = (askSwarm && data) || NO_HITS;
  const searching = askSwarm && (settled !== q.trim() || isFetching);

  const hits = useMemo(() => {
    const query = q.trim();
    if (!query) return [];
    const local = searchLoaded(graph, query);
    const seen = new Set(local.map((h) => h.ref_id));
    return [...local, ...remote.filter((h) => !seen.has(h.ref_id))].slice(0, SEARCH_LIMIT);
  }, [q, graph, remote]);

  const pick = (hit: GraphSearchHit) => {
    focusNode(hit.ref_id);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative min-w-40 max-w-sm flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            pick(hits[active]);
          } else if (e.key === "Escape") {
            setQ("");
            inputRef.current?.blur();
          }
        }}
        placeholder={`Search ${type} nodes`}
        className="h-8 pl-8 text-sm"
        data-testid="graph-workbench-search"
      />
      {open && q.trim() && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-md"
          data-testid="graph-workbench-search-results"
        >
          {hits.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              {searching && <Loader2 className="h-3 w-3 animate-spin" />}
              {searching ? "Searching…" : `No ${type} nodes match “${q}”.`}
            </p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.ref_id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex w-full flex-col items-start px-3 py-1.5 text-left", i === active && "bg-accent")}
              >
                <span className="w-full truncate text-sm">{hit.name}</span>
                {graph.nodes[hit.ref_id] ? (
                  <PathLabel graph={graph} id={hit.ref_id} />
                ) : (
                  hit.description && (
                    <span className="w-full truncate text-[11px] text-muted-foreground">{hit.description}</span>
                  )
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What needs attention: nodes outside any tree, misfiled links, empty text,
 * nodes nobody reads. The count is the nodes to fix — "never read" is only
 * worth knowing, so it isn't counted.
 */
function HealthMenu({ graph }: { graph: WorkbenchGraph }) {
  const { focusNode } = useWorkbench();
  const groups = useMemo(() => health(graph), [graph]);
  const toFix = useMemo(() => new Set(groups.filter((g) => g.key !== "unread").flatMap((g) => g.ids)).size, [groups]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2 font-normal text-muted-foreground has-[>svg]:px-2 data-[state=open]:bg-accent"
          title="Health: nodes outside any tree, with several parents, or with empty docs"
          aria-label={`Health: ${toFix} nodes to look at`}
          data-testid="graph-workbench-health"
        >
          <Stethoscope className="size-3.5" />
          <span className="tabular-nums">{toFix}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
        {groups.map((g, i) => (
          <React.Fragment key={g.key}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-baseline justify-between">
              <span>{g.label}</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">{g.ids.length}</span>
            </DropdownMenuLabel>
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">{g.hint}</p>
            {g.ids.map((id) => (
              <DropdownMenuItem key={id} onSelect={() => focusNode(id)} className="flex-col items-start gap-0">
                <span className="text-sm">{graph.nodes[id].name}</span>
                {g.key === "unplaced" ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {graph.nodes[id].repo ?? "No repo"}
                  </span>
                ) : (
                  <PathLabel graph={graph} id={id} />
                )}
              </DropdownMenuItem>
            ))}
            {g.ids.length === 0 && <p className="px-2 pb-2 text-xs text-muted-foreground">None.</p>}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One row: the path to what's drawn (leading crumb / node type by edge / root), search, then health and `trailing`. */
export function Toolbar({ leading, trailing }: { leading?: React.ReactNode; trailing?: React.ReactNode }) {
  const { graph } = useWorkbench();
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2"
      data-testid="graph-workbench-toolbar"
    >
      <nav aria-label="What the canvas shows" className="flex min-w-0 items-center">
        {leading && (
          <>
            {leading}
            <Slash />
          </>
        )}
        <LensPicker />
        {graph && (
          <>
            <Slash />
            <RootPicker graph={graph} />
          </>
        )}
      </nav>
      {graph && <GraphSearch graph={graph} />}
      <div className="ml-auto flex items-center gap-1">
        {graph && <HealthMenu graph={graph} />}
        {trailing}
      </div>
    </div>
  );
}
