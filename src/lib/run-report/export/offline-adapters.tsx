/**
 * Offline-safe adapter components for the SSR export renderer.
 *
 * Each adapter replaces a server-dependent leaf in the RunReportView /
 * ConsolidatedReportView component tree so that `renderToStaticMarkup`
 * produces fully self-contained HTML with zero network calls.
 *
 * Adapters:
 *   OfflineViewInGraphLink    — replaces ViewInGraphLink (disabled chip)
 *   OfflineStakworkRunLink    — replaces StakworkRunLink (disabled chip)
 *   OfflineNodePeekContainer  — renders from prefetched peek map (or omits)
 *   OfflineDocLink            — replaces doc-proxy / documents?url= links
 *   OfflineSourceFileLink     — replaces consolidated sourceFileLinks
 *
 * All adapters must:
 *   - Render as plain React elements with no dangerouslySetInnerHTML
 *   - Never issue fetch() or any network call
 *   - Be usable inside React.renderToStaticMarkup (no hooks that need client)
 */

import React from "react";
import type { NodePeek } from "@/components/run-report/NodePeek";
import { NodePeekBody } from "@/components/run-report/NodePeek";

// ── "Available online" chip ───────────────────────────────────────────────────

/**
 * Static "Available online" chip — replaces all server-dependent link surfaces
 * (ViewInGraphLink, StakworkRunLink, and any other live-link components).
 *
 * Renders as a disabled-looking span with a tooltip so users know the
 * affordance exists online. No <a> tag, no href, no network call.
 */
export function AvailableOnlineChip({
  label = "Available online",
  title = "This link is only available in the online report.",
}: {
  label?: string;
  title?: string;
}) {
  return (
    <span
      data-offline-chip="true"
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground/50 select-none cursor-default"
      aria-label={`${label} (offline export — not available)`}
    >
      {label}
    </span>
  );
}

// ── ViewInGraphLink adapter ───────────────────────────────────────────────────

/**
 * Offline replacement for ViewInGraphLink.
 * Renders a static "Available online" chip with no link or graph fetch.
 */
export function OfflineViewInGraphLink(_props: {
  workspaceSlug?: string | null;
  refId?: string | null;
}) {
  return <AvailableOnlineChip label="View in graph" title="Graph Explorer is only available in the online report." />;
}

// ── StakworkRunLink adapter ───────────────────────────────────────────────────

/**
 * Offline replacement for StakworkRunLink.
 * Renders a static "View on Stakwork" label with no link.
 */
export function OfflineStakworkRunLink(_props: {
  projectId?: number | null;
  isSuperAdmin?: boolean;
  showForAll?: boolean;
}) {
  return (
    <span
      data-offline-chip="true"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/40 select-none"
      title="Stakwork link is only available in the online report."
    >
      View on Stakwork (available online)
    </span>
  );
}

// ── NodePeek container ────────────────────────────────────────────────────────

/**
 * Pre-rendered node peek container for offline export.
 *
 * If the refId is in the prefetched peek map and the state is "done", renders
 * the peek body inside a collapsible container (toggle handled by viewer.js).
 * If the peek is missing or errored, omits the container entirely — no broken
 * "View in graph" link or spinner.
 */
export function OfflineNodePeekContainer({
  refId,
  peeks,
  label = "Node peek",
}: {
  refId: string | null | undefined;
  peeks: Map<string, NodePeek>;
  label?: string;
}) {
  if (!refId) return null;
  const peek = peeks.get(refId);
  if (!peek || peek.state !== "done") return null;

  return (
    <div
      data-peek-container="true"
      data-peek-ref-id={refId}
      className="mt-2 rounded-md border border-border/50 bg-muted/10 overflow-hidden"
    >
      <button
        type="button"
        data-peek-toggle="true"
        className="w-full flex items-center justify-between px-3 py-2 text-left font-mono text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{label}</span>
        <span className="peek-toggle-indicator opacity-50">▼</span>
      </button>
      <div className="peek-body px-3 pb-3 hidden peek-open:block">
        <NodePeekBody payload={peek.payload} />
      </div>
    </div>
  );
}

// ── Document link adapter ─────────────────────────────────────────────────────

/**
 * Offline replacement for doc-proxy / DocumentViewerModal affordances.
 *
 * When the document was packed into the ZIP, renders a plain local anchor
 * pointing at documents/<entryName>. When not packed, renders a static
 * "available online" label.
 */
export function OfflineDocLink({
  label,
  entryName,
}: {
  label: string;
  entryName: string | null;
}) {
  if (!entryName) {
    return <AvailableOnlineChip label={label} title="Document available in the online report only." />;
  }
  return (
    <a
      href={`documents/${entryName}`}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
    >
      📄 {label}
    </a>
  );
}

// ── Source file link adapter ──────────────────────────────────────────────────

/**
 * Offline replacement for consolidated report source file links.
 *
 * - URLs that were packed: plain local anchor → documents/<entryName>
 * - URLs that were skipped: static "available online" label
 * - .docx "Edit" links are always omitted in offline mode (doc editor requires live app)
 */
export function OfflineSourceFileLink({
  url,
  packedEntryName,
}: {
  url: string;
  packedEntryName: string | null;
}) {
  const label = url.split("/").pop() ?? url;

  if (packedEntryName) {
    return (
      <a
        href={`documents/${packedEntryName}`}
        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        data-testid="offline-source-file-link"
      >
        📄 {label}
      </a>
    );
  }

  return (
    <AvailableOnlineChip
      label={`📄 ${label}`}
      title="Source file available in the online report only."
    />
  );
}

// ── Offline context object ────────────────────────────────────────────────────

/**
 * Context passed through the offline render tree to adapters that need
 * dynamic data (peek map, packed document list).
 *
 * This is a plain object rather than a React context (which needs Provider and
 * isn't compatible with renderToStaticMarkup in all cases). Adapters that need
 * it are instantiated with it directly as props.
 */
export interface OfflineRenderContext {
  /** Prefetched node peek payloads keyed by refId. */
  peeks: Map<string, NodePeek>;
  /**
   * Mapping from source URL → packed zip entry name.
   * Only contains entries that were successfully packed.
   */
  packedDocsByUrl: Map<string, string>;
  /** Workspace slug (used for display only in offline mode — no fetches). */
  workspaceSlug: string | null;
}
