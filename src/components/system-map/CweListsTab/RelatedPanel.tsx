"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { CweEntry, CweRelatedNode, CweRelatedResponse } from "@/types/system-map";

function RelatedList({ title, items, empty }: { title: string; items: CweRelatedNode[]; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title} <span className="normal-case tracking-normal">· {items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/80">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={`${item.refId}-${index}`} className="rounded-md bg-muted/30 px-2 py-1.5">
              <p className="text-xs font-medium">{item.name}</p>
              {item.details.length > 0 && <p className="text-[11px] text-muted-foreground">{item.details.join(" · ")}</p>}
              {item.description && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground" title={item.description}>
                  {item.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A CWE's test templates, mitigations, detection methods and platforms, read when first shown. */
export function RelatedPanel({ cwe }: { cwe: CweEntry }) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  // Keyed by refId so a new CWE reads as loading without a synchronous reset in the effect.
  const [state, setState] = useState<{ refId: string; data: CweRelatedResponse } | null>(null);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(`/api/workspaces/${slug}/system-map/cwe-related?refId=${encodeURIComponent(cwe.refId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as CweRelatedResponse;
      })
      .catch((error: unknown): CweRelatedResponse => ({
        status: "error",
        error: error instanceof Error ? error.message : "Request failed",
      }))
      .then((data) => {
        if (!controller.signal.aborted) setState({ refId: cwe.refId, data });
      });
    return () => controller.abort();
  }, [slug, cwe.refId]);

  if (!state || state.refId !== cwe.refId) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading related nodes…
      </p>
    );
  }
  const { data } = state;
  if (data.status === "error") {
    return <p className="text-xs text-destructive">Could not load related nodes: {data.error}</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-3" data-testid="cwe-related">
      <RelatedList
        title="Test templates"
        items={data.templates}
        empty="No SecurityTestTemplate yet. The CWE check generates one on first use."
      />
      <RelatedList title="Mitigations" items={data.mitigations} empty="No MITIGATED_BY edges." />
      <RelatedList title="Detection methods" items={data.detection} empty="No DETECTABLE_BY edges." />
      {data.platforms.length > 0 && (
        <p className="text-[11px] text-muted-foreground md:col-span-3">
          <span className="font-medium uppercase tracking-wider">Platforms</span> ·{" "}
          {data.platforms
            .map((p) => (p.details.length > 0 ? `${p.name} (${p.details.join(", ")})` : p.name))
            .join(", ")}
        </p>
      )}
    </div>
  );
}
