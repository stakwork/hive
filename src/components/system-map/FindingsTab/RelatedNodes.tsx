"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { SystemMapFindingRelated, SystemMapFindingRelatedResponse } from "@/types/system-map";

function RelatedRow({ node }: { node: SystemMapFindingRelated }) {
  const [open, setOpen] = useState(false);
  const Arrow = node.direction === "out" ? ArrowRight : ArrowLeft;
  return (
    <li className="rounded-md bg-muted/30 px-2 py-1.5" data-testid="finding-related-row">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <Arrow className="h-3 w-3" />
          {node.edgeType}
        </span>
        <span className="min-w-0 truncate text-xs font-medium">{node.name}</span>
        {node.file && node.file !== node.name && (
          <span className="ml-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground">{node.file}</span>
        )}
      </button>
      {open && (
        <dl className="mt-1.5 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t pt-1.5 text-[11px]">
          {Object.entries(node.properties)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="truncate font-mono text-muted-foreground">{key}</dt>
                <dd className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </dd>
              </React.Fragment>
            ))}
          <dt className="truncate font-mono text-muted-foreground">ref_id</dt>
          <dd className="break-all font-mono">{node.refId}</dd>
        </dl>
      )}
    </li>
  );
}

/** A finding's neighbours from every namespace, grouped by node type, read when the finding is first opened. */
export function RelatedNodes({ refId }: { refId: string }) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  // Keyed by refId so a new finding reads as loading without a synchronous reset in the effect.
  const [state, setState] = useState<{ refId: string; data: SystemMapFindingRelatedResponse } | null>(null);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(`/api/workspaces/${slug}/system-map/findings/related?refId=${encodeURIComponent(refId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as SystemMapFindingRelatedResponse;
      })
      .catch((error: unknown): SystemMapFindingRelatedResponse => ({
        status: "error",
        error: error instanceof Error ? error.message : "Request failed",
      }))
      .then((data) => {
        if (!controller.signal.aborted) setState({ refId, data });
      });
    return () => controller.abort();
  }, [slug, refId]);

  const groups = useMemo(() => {
    if (state?.data.status !== "ready") return [];
    const byType = new Map<string, SystemMapFindingRelated[]>();
    for (const node of state.data.related) byType.set(node.nodeType, [...(byType.get(node.nodeType) ?? []), node]);
    return [...byType.entries()].map(([nodeType, nodes]) => ({ nodeType, nodes }));
  }, [state]);

  if (!state || state.refId !== refId) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading related nodes…
      </p>
    );
  }
  if (state.data.status === "error") {
    return <p className="text-xs text-destructive">Could not load related nodes: {state.data.error}</p>;
  }
  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground/80">No related nodes.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="finding-related">
      {groups.map(({ nodeType, nodes }) => (
        <div key={nodeType}>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {nodeType} <span className="normal-case tracking-normal">· {nodes.length}</span>
          </p>
          <ul className="flex flex-col gap-1">
            {nodes.map((node) => (
              <RelatedRow key={`${node.refId}-${node.edgeType}-${node.direction}`} node={node} />
            ))}
          </ul>
        </div>
      ))}
      {state.data.truncated && (
        <p className="text-[11px] text-muted-foreground md:col-span-2 xl:col-span-3">
          Showing the first {state.data.related.length} related nodes.
        </p>
      )}
    </div>
  );
}
