"use client";

import React from "react";
import { isRecord } from "@/lib/run-report/derive";
import { renderValue } from "./chrome";
import { SafeMarkdown } from "./SafeMarkdown";

/**
 * Shared "peek at a graph node" primitives: the authed fetch and the body
 * renderer. Used by the run report's concept chips and by the session
 * cascade's right-hand concept rail so both peeks show the same thing.
 */

export type NodePeek =
  | { state: "loading" }
  | { state: "done"; payload: unknown }
  | { state: "error"; note: string };

/**
 * Fetch one node by ref_id through the workspace-scoped route (the same authed
 * path the /learn page uses). Never throws — every failure is an error peek.
 */
export async function fetchNodePeek(
  workspaceSlug: string | null | undefined,
  refId: string | null | undefined,
): Promise<NodePeek> {
  if (!refId) return { state: "error", note: "The run recorded no ref_id for this node." };
  if (!workspaceSlug) {
    return { state: "error", note: "Live node fetch needs a workspace context." };
  }
  try {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/nodes/${encodeURIComponent(refId)}`,
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return {
        state: "error",
        note: `Graph lookup failed (${res.status}${json?.error ? `: ${json.error}` : ""}).`,
      };
    }
    return { state: "done", payload: json.data };
  } catch {
    return { state: "error", note: "Fetch failed." };
  }
}

/**
 * Renders a raw graph node: content-bearing properties (description,
 * definition, body...) as prose first, every remaining attribute as
 * key/values. No edge expansion - this is the node itself.
 */
export function NodePeekBody({ payload }: { payload: unknown }) {
  if (!isRecord(payload)) {
    return <div className="text-[12.5px]">{renderValue(payload)}</div>;
  }
  const base = isRecord(payload.node) ? payload.node : payload;
  const nested = isRecord(base.properties) ? base.properties : {};
  const merged: Record<string, unknown> = { ...base, ...nested };
  const IDENTITY = new Set(["ref_id", "node_type", "name", "properties", "date_added_to_graph"]);
  // Concept nodes carry their content in `docs`; other node types use the rest.
  const CONTENT_KEYS = ["docs", "description", "definition", "body", "content", "text", "summary"];

  const added = merged.date_added_to_graph ?? base.date_added_to_graph;
  const addedSec =
    typeof added === "number" ? added : typeof added === "string" && /^\d+$/.test(added) ? Number(added) : null;

  const asProse = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim().length > 0) return v;
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
      return v.join("\n\n");
    }
    return null;
  };
  const prose = CONTENT_KEYS.map((k) => [k, asProse(merged[k])] as const).filter(
    (entry): entry is readonly [string, string] => entry[1] !== null,
  );
  const proseKeys = new Set(prose.map(([k]) => k));
  const rest = Object.entries(merged).filter(
    ([k, v]) => !IDENTITY.has(k) && !proseKeys.has(k) && v !== null && v !== undefined && v !== "",
  );

  return (
    <div className="text-[12.5px] space-y-2">
      {addedSec !== null && (
        <div className="font-mono text-[10.5px] text-muted-foreground/70">
          added to graph {new Date(addedSec * 1000).toISOString().slice(0, 10)}
        </div>
      )}
      {prose.map(([k, v]) => (
        <div key={k}>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60 mb-0.5">
            {k}
          </div>
          <SafeMarkdown text={v} />
        </div>
      ))}
      {rest.length > 0 && (
        <dl className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {rest.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="font-mono text-[10.5px] text-muted-foreground/70 truncate pt-0.5">{k}</dt>
              <dd className="break-words">{typeof v === "object" ? renderValue(v) : String(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {prose.length === 0 && rest.length === 0 && (
        <p className="text-[12px] text-muted-foreground italic">
          The graph stores no content on this node — identity only. A populated
          concept would carry its doctrine in a docs attribute here.
        </p>
      )}
    </div>
  );
}
