"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Restore-from-hidden pill.
 *
 * Lives in the top-right of the root canvas area. Renders nothing when
 * no live entries are hidden, so the steady-state UI stays clean. When
 * one or more workspaces (or, later, features / repos) have been
 * "deleted" from the canvas (really: hidden via `/canvas/hide`), the
 * pill becomes visible and offers a popover to restore them.
 *
 * Why a pill, not a `+` menu item: hiding/showing an existing DB entity
 * and *creating* a new node are different concepts. The `+` FAB stays
 * for authoring (objectives, notes, decisions); restore is its own
 * affordance, and disappears entirely when empty.
 */

export interface HiddenLiveEntry {
  /** Round-trip id, e.g. `ws:abc…`. */
  id: string;
  /** Display name sourced from the projector. */
  name: string;
  /** `"ws" | "feature" | "repo" | …` — the prefix before the colon. */
  kind: string;
}

interface HiddenLivePillProps {
  entries: HiddenLiveEntry[];
  onRestore: (id: string) => void | Promise<void>;
}

/**
 * Human-readable category label for a pluralized header. Falls back to
 * the raw kind capitalized so unknown kinds still render something
 * sensible instead of an empty string.
 */
function pluralLabel(kind: string, count: number): string {
  const map: Record<string, [string, string]> = {
    ws: ["workspace", "workspaces"],
    feature: ["feature", "features"],
    repo: ["repository", "repositories"],
  };
  const [singular, plural] = map[kind] ?? [kind, `${kind}s`];
  return count === 1 ? singular : plural;
}

export function HiddenLivePill({ entries, onRestore }: HiddenLivePillProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click / Escape. Mirrors the library's AddNodeButton
  // behavior so the two popovers feel like siblings.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close when the list empties (e.g. user restored the last entry).
  useEffect(() => {
    if (entries.length === 0) setOpen(false);
  }, [entries.length]);

  if (entries.length === 0) return null;

  // Group by kind so the popover has a "Hidden workspaces" header.
  // Today the only projected kind users can hide is `ws:`, but keeping
  // the grouping in place means adding a new kind (feature/repo) won't
  // need another UI pass.
  const groups = new Map<string, HiddenLiveEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.kind) ?? [];
    list.push(e);
    groups.set(e.kind, list);
  }

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 25,
        fontFamily:
          "'Inter', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif",
        fontSize: 12,
        userSelect: "none",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 999,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "rgba(21, 23, 28, 0.85)",
          color: "rgba(255, 255, 255, 0.75)",
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
        }}
        aria-label={open ? "Close hidden list" : "Open hidden list"}
      >
        <span>
          {entries.length} hidden
        </span>
        <span
          style={{
            fontSize: 9,
            opacity: 0.6,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 36,
            right: 0,
            minWidth: 240,
            maxHeight: 360,
            overflowY: "auto",
            padding: 6,
            background: "rgba(21, 23, 28, 0.95)",
            color: "rgba(255, 255, 255, 0.9)",
            borderRadius: 10,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
            backdropFilter: "blur(10px)",
          }}
        >
          {[...groups.entries()].map(([kind, items], idx) => (
            <div key={kind}>
              {idx > 0 && (
                <div
                  style={{
                    height: 1,
                    margin: "4px 0",
                    background: "rgba(255, 255, 255, 0.08)",
                  }}
                />
              )}
              <div
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  opacity: 0.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Hidden {pluralLabel(kind, items.length)}
              </div>
              {items.map((entry) => (
                <RestoreRow
                  key={entry.id}
                  entry={entry}
                  onRestore={onRestore}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RestoreRow({
  entry,
  onRestore,
}: {
  entry: HiddenLiveEntry;
  onRestore: (id: string) => void | Promise<void>;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        background: hover ? "rgba(255, 255, 255, 0.06)" : "transparent",
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={entry.name}
      >
        {entry.name}
      </span>
      <button
        type="button"
        onClick={() => void onRestore(entry.id)}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid rgba(255, 255, 255, 0.15)",
          background: "transparent",
          color: "rgba(255, 255, 255, 0.85)",
          fontSize: 11,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Restore
      </button>
    </div>
  );
}
