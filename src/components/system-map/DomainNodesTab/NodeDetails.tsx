"use client";

import React, { useMemo } from "react";
import { X } from "lucide-react";
import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";
import { PACKAGE_TYPE } from "./architecture";
import { formatValue, shortType } from "./DomainGraph";

/** A node's name as a link that opens it (on the map, in the Dependencies view, or here). */
export function NodeLink({ node, onOpen }: { node: SystemMapDomainNode; onOpen: (refId: string) => void }) {
  return (
    <button
      type="button"
      className="text-left text-blue-600 hover:underline dark:text-blue-400"
      onClick={() => onOpen(node.refId)}
    >
      {node.name}
    </button>
  );
}

/** Bookkeeping the map writes on every node; not useful when reading one. */
const HIDDEN_PROPERTIES = new Set(["name", "schema_hash", "origin"]);

export function PropertyList({ node }: { node: SystemMapDomainNode }) {
  const entries = Object.entries(node.properties)
    .filter(
      ([key, value]) =>
        !HIDDEN_PROPERTIES.has(key) &&
        !(key === "gone" && value === false) &&
        value !== null &&
        value !== undefined &&
        value !== "",
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return (
    <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt className="truncate font-mono text-muted-foreground" title={key}>
            {key}
          </dt>
          <dd className="break-words">{formatValue(value)}</dd>
        </React.Fragment>
      ))}
      <dt className="font-mono text-muted-foreground">ref_id</dt>
      <dd className="break-all font-mono text-[10px]">{node.refId}</dd>
    </dl>
  );
}

/**
 * The side panel for any System Map node: its properties and its
 * connections grouped by direction and edge type, packages counted
 * rather than listed.
 */
export function NodeDetails({
  node,
  edges,
  byRef,
  lane,
  duplicates = [],
  onOpen,
  onOpenPackages,
  onClose,
}: {
  node: SystemMapDomainNode;
  edges: SystemMapDomainEdge[];
  byRef: Map<string, SystemMapDomainNode>;
  lane?: string;
  duplicates?: string[];
  onOpen: (refId: string) => void;
  onOpenPackages: () => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const out = new Map<string, SystemMapDomainNode[]>();
    for (const e of edges) {
      const key = e.source === node.refId ? `→ ${e.edgeType}` : e.target === node.refId ? `← ${e.edgeType}` : null;
      const other = byRef.get(e.source === node.refId ? e.target : e.source);
      if (!key || !other) continue;
      out.set(key, [...(out.get(key) ?? []), other]);
    }
    return [...out.entries()];
  }, [edges, byRef, node.refId]);

  return (
    <div className="space-y-3 text-xs" data-testid="system-map-node-detail">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{node.name}</p>
          <p className="font-mono text-[11px] text-muted-foreground" title={node.type}>
            {shortType(node.type)}
            {lane && ` · ${lane}`}
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
      {duplicates.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          May describe the same thing as{" "}
          {duplicates.map((id, i) => (
            <React.Fragment key={id}>
              {i > 0 && ", "}
              {byRef.get(id) && <NodeLink node={byRef.get(id)!} onOpen={onOpen} />}
            </React.Fragment>
          ))}
        </p>
      )}
      <PropertyList node={node} />
      <div>
        <p className="mb-1 font-medium">Connections</p>
        {groups.length === 0 && <p className="text-muted-foreground">None</p>}
        <ul className="space-y-1">
          {groups.map(([key, others]) => {
            const packages = others.filter((o) => o.type === PACKAGE_TYPE);
            const rest = others.filter((o) => o.type !== PACKAGE_TYPE);
            return (
              <li key={key} className="flex gap-2">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{key}</span>
                <span className="min-w-0">
                  {rest.map((o, i) => (
                    <React.Fragment key={o.refId}>
                      {i > 0 && ", "}
                      <NodeLink node={o} onOpen={onOpen} />
                    </React.Fragment>
                  ))}
                  {packages.length > 0 && (
                    <>
                      {rest.length > 0 && ", "}
                      {packages.length === 1 ? (
                        <NodeLink node={packages[0]} onOpen={onOpen} />
                      ) : (
                        <button
                          type="button"
                          className="text-blue-600 hover:underline dark:text-blue-400"
                          onClick={onOpenPackages}
                        >
                          {packages.length} packages
                        </button>
                      )}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
