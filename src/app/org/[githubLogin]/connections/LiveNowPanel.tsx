"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { AttentionTypeMeta } from "@/services/attention/typeMeta";
import { getAttentionDOMIcon } from "@/services/attention/typeMeta";
import {
  LIVE_NOW_GROUP_LABELS,
  formatRunningLabel,
  liveNowGroupOf,
  type LiveNowRow,
} from "./useLiveNowItems";
import { useCanvasChatStore } from "../_state/canvasChatStore";

/**
 * Live Now panel — a compact, collapsible overlay docked on the org
 * canvas that answers "what needs me, and what's running?" at a glance.
 *
 * Pure presentation over the ranked rows from `useLiveNowItems`: no
 * fetching, no polling, no canvas mutation. The parent
 * (`OrgCanvasBackground`) mounts it as a sibling of `HiddenLivePill`
 * (which owns `top:16, right:16, zIndex:25`); this panel stacks
 * directly beneath it at `top:60, right:16, zIndex:24`, inside the
 * canvas container so it tracks the same chat-sidebar `rightInset`.
 *
 * Behavior contract:
 * - **Empty list ⇒ renders nothing at all** — not a collapsed stub.
 *   This precedence is absolute and overrides any expand state,
 *   matching the brief's "gets out of the way when nothing is active"
 *   and `HiddenLivePill`'s zero-chrome default.
 * - Two labeled groups ("Needs you", "Running"); a group with no rows
 *   hides its own header. The labels are load-bearing: the attention
 *   feed is ownership-filtered ("mine") while running activity covers
 *   every projected feature ("everyone's").
 * - Collapse is a single in-memory `useState` — no `localStorage`
 *   persistence (intentionally out of scope).
 * - Muted footer shows `lastUpdatedAt` as a relative "updated Ns ago"
 *   string. The attention map is Pusher-driven with a 2s trailing
 *   debounce plus a 30s interval poll, so a row can trail reality by
 *   up to ~30s — the panel shows its own freshness rather than
 *   implying hard realtime.
 * - Row click: `fallbackOnly` rows (no guaranteed canvas target) open
 *   the row's workspace-scoped `link` in a new tab; everything else
 *   dispatches a `pendingDeeplink` command through the canvas chat
 *   store, consumed by `runDeeplinkNavigation` in
 *   `OrgCanvasBackground` — the same code path chat deeplink chips
 *   use. No `onFocus` prop drilling.
 */

export interface LiveNowPanelProps {
  /** Ranked rows from `useLiveNowItems` (already capped at 12). */
  rows: readonly LiveNowRow[];
  /** Rows cut by the cap — drives the "+N more" hint. */
  overflowCount: number;
  /** Wall-clock ms of the last attention refresh (0 until first fetch). */
  lastUpdatedAt: number;
}

type AttentionIconName = AttentionTypeMeta["iconName"];
type AttentionIconComponent = React.ComponentType<
  React.SVGProps<SVGSVGElement>
>;

// Glass palette shared with HiddenLivePill so the two overlays read as
// siblings on the dark canvas background (#15171c).
const PANEL_BG = "rgba(21, 23, 28, 0.95)";
const PANEL_BORDER = "1px solid rgba(255, 255, 255, 0.08)";
const PANEL_SHADOW = "0 8px 24px rgba(0, 0, 0, 0.35)";
const TEXT_PRIMARY = "rgba(255, 255, 255, 0.9)";
const TEXT_MUTED = "rgba(255, 255, 255, 0.5)";
const FONT_FAMILY =
  "'Inter', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif";

/** Tiny spinning circle — running activity indicator. */
function MiniSpinner({ color, title }: { color: string; title?: string }) {
  return (
    <span
      title={title}
      aria-hidden
      className="inline-block animate-spin rounded-full"
      style={{
        width: 8,
        height: 8,
        border: `1.5px solid ${color}`,
        borderTopColor: "transparent",
        flexShrink: 0,
      }}
    />
  );
}

/** Secondary inline running signal on a row whose node is also live. */
function RunningIndicator({
  running,
}: {
  running: { plannerRunning: boolean; agentsRunningCount: number };
}) {
  if (!running.plannerRunning && running.agentsRunningCount === 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        color: TEXT_MUTED,
        fontSize: 10,
        flexShrink: 0,
      }}
      title={formatRunningLabel(running)}
    >
      <MiniSpinner color="#f59e0b" />
      {running.agentsRunningCount > 0 && <span>{running.agentsRunningCount}</span>}
    </span>
  );
}

export function LiveNowPanel({
  rows,
  overflowCount,
  lastUpdatedAt,
}: LiveNowPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const triggerDeeplink = useCanvasChatStore((s) => s.triggerDeeplink);

  // One-second ticker for the "updated Ns ago" footer. Starts null so
  // server-rendered markup matches the first client render; the effect
  // below fills it in immediately after mount.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Resolve attention glyphs through the shared `getAttentionDOMIcon`
  // adapter (async — lazily imports lucide-react). Only the icon names
  // actually present in `rows` are requested; there are at most the
  // three canonical ones. Until a glyph arrives, the row falls back to
  // a status-colored dot — color arrives instantly, the glyph lands a
  // frame later.
  const iconNames = useMemo(() => {
    const names = new Set<AttentionIconName>();
    for (const row of rows) {
      if (row.iconName) names.add(row.iconName);
    }
    return [...names];
  }, [rows]);

  const [icons, setIcons] = useState<
    Partial<Record<AttentionIconName, AttentionIconComponent>>
  >({});

  useEffect(() => {
    if (iconNames.length === 0) return;
    let cancelled = false;
    void Promise.all(
      iconNames.map(async (name) => ({
        name,
        icon: await getAttentionDOMIcon(name),
      })),
    )
      .then((loaded) => {
        if (cancelled) return;
        setIcons((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const { name, icon } of loaded) {
            if (next[name] !== icon) {
              next[name] = icon;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      })
      .catch(() => {
        // Glyph load failure — rows keep the colored-dot fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [iconNames]);

  // Zero chrome when nothing is active — absolute precedence over the
  // user's expand state. (Hooks above run unconditionally; this early
  // return only fires when the panel has nothing to show.)
  if (rows.length === 0) return null;

  const needsYou = rows.filter((r) => liveNowGroupOf(r) === "needs-you");
  const running = rows.filter((r) => liveNowGroupOf(r) === "running");

  const secondsAgo =
    lastUpdatedAt > 0 && now !== null
      ? Math.max(0, Math.floor((now - lastUpdatedAt) / 1000))
      : null;
  const footerText =
    secondsAgo === null
      ? "Updated just now"
      : secondsAgo < 60
        ? `Updated ${secondsAgo}s ago`
        : `Updated ${Math.floor(secondsAgo / 60)}m ${secondsAgo % 60}s ago`;

  function handleRowClick(row: LiveNowRow) {
    // Rows without a guaranteed canvas target (task with no parent
    // feature; `ws:`-ref rows where pinning is unverifiable) open the
    // workspace-scoped link instead of dispatching a deep link — the
    // click is never a dead end.
    if (row.fallbackOnly || !row.nodeId) {
      if (row.link) {
        window.open(row.link, "_blank", "noopener,noreferrer");
      }
      return;
    }
    triggerDeeplink({
      nodeId: row.nodeId,
      canvasRef: row.canvasRef,
      label: row.title,
    });
  }

  const renderRow = (row: LiveNowRow) => {
    const Icon = row.iconName ? icons[row.iconName] : undefined;
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => handleRowClick(row)}
        title={`${row.title} — ${row.label}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: TEXT_PRIMARY,
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {Icon ? (
          <Icon
            width={14}
            height={14}
            style={{ color: row.colorHex, flexShrink: 0 }}
          />
        ) : row.running && !row.iconName ? (
          <MiniSpinner color={row.colorHex} />
        ) : (
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: row.colorHex,
              flexShrink: 0,
            }}
          />
        )}
        <span style={{ flex: 1, minWidth: 0, display: "block" }}>
          <span
            style={{
              display: "block",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: 12,
              lineHeight: "16px",
            }}
          >
            {row.title}
          </span>
          <span
            style={{
              display: "block",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontSize: 10,
              lineHeight: "14px",
              color: row.colorHex,
              opacity: 0.9,
            }}
          >
            {row.label}
          </span>
        </span>
        {row.running && <RunningIndicator running={row.running} />}
      </button>
    );
  };

  const renderGroup = (label: string, groupRows: LiveNowRow[]) => {
    // A group with no rows hides its own header entirely.
    if (groupRows.length === 0) return null;
    return (
      <div key={label} style={{ marginBottom: 4 }}>
        <div
          style={{
            padding: "4px 8px",
            fontSize: 10,
            color: TEXT_MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
        {groupRows.map(renderRow)}
      </div>
    );
  };

  return (
    <div
      aria-label="Live now"
      style={{
        position: "absolute",
        top: 60,
        right: 16,
        zIndex: 24,
        width: 280,
        fontFamily: FONT_FAMILY,
        fontSize: 12,
        userSelect: "none",
      }}
    >
      <div
        style={{
          background: PANEL_BG,
          border: PANEL_BORDER,
          borderRadius: 10,
          boxShadow: PANEL_SHADOW,
          backdropFilter: "blur(10px)",
          color: TEXT_PRIMARY,
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            padding: "8px 10px",
            border: "none",
            borderBottom: collapsed ? "none" : PANEL_BORDER,
            background: "transparent",
            color: TEXT_PRIMARY,
            font: "inherit",
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            aria-hidden
            className="inline-block animate-pulse"
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: "#10b981",
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>Live Now</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 400,
              color: TEXT_MUTED,
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: 999,
              padding: "1px 6px",
            }}
          >
            {rows.length + overflowCount}
          </span>
          <span
            aria-hidden
            style={{
              fontSize: 9,
              color: TEXT_MUTED,
              transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.15s ease",
            }}
          >
            ▾
          </span>
        </button>

        {!collapsed && (
          <>
            <div style={{ maxHeight: 320, overflowY: "auto", padding: 6 }}>
              {renderGroup(LIVE_NOW_GROUP_LABELS.needsYou, needsYou)}
              {renderGroup(LIVE_NOW_GROUP_LABELS.running, running)}
              {overflowCount > 0 && (
                <div
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    color: TEXT_MUTED,
                  }}
                >
                  +{overflowCount} more
                </div>
              )}
            </div>
            <div
              style={{
                padding: "4px 10px 6px",
                fontSize: 10,
                color: TEXT_MUTED,
                borderTop: PANEL_BORDER,
              }}
            >
              {footerText}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
