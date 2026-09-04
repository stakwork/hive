"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, FileText, Loader2, MessageCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { jamieName } from "@/lib/constants/jamie";
import { formatAge } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { ControlPanelItem, ControlPanelItemKind, ControlPanelItemState } from "@/types/control-panel";
import { NEEDS_YOU_STATES, type ControlPanelGroup } from "@/services/orgs/control-panel-state";
import { ActionTip } from "../ActionTip";
import { CONTROL_PANEL_PAGE } from "./useControlPanelItems";

/** A row that changes place slides there rather than jumping (a sent message bubbles its chat up). */
const ROW_MOVE = { layout: { duration: 0.35, ease: "easeInOut" } } as const;

/** Kind is icon and colour: a Jamie chat is sky, the plan it spawned violet (the violet a plan artifact pill wears). */
const KIND: Record<ControlPanelItemKind, { Icon: typeof MessageCircle; className: string }> = {
  chat: { Icon: MessageCircle, className: "text-sky-500" },
  plan: { Icon: FileText, className: "text-violet-500" },
};

/**
 * Row geometry, in pixels, from the row's classes: `py-2.5`, the icon's
 * `mt-0.5`, a chat's `h-4` icon, a plan's `h-3.5` one, `gap-2` between the
 * chevron (`w-4`) and count (`w-3`) columns. A chat's icon follows those
 * columns; its plans start under its title, hanging off a guide that runs
 * down the chat icon's centre to a tick at each plan.
 */
const ROW_PAD_Y = 10;
const ICON_TOP = 2;
const CHAT_ICON = 16;
const PLAN_ICON = 14;
const CHAT_ROW_PAD = 8;
const CHAT_ICON_LEFT = CHAT_ROW_PAD + 16 + 8 + 12 + 8;
const GUIDE_LEFT = CHAT_ICON_LEFT + CHAT_ICON / 2;
const PLAN_ROW_PAD = CHAT_ICON_LEFT + CHAT_ICON + 8;
const ICON_CENTER_TOP = ROW_PAD_Y + ICON_TOP + PLAN_ICON / 2;
/** A breath below the chat icon, where its stem starts. */
const STEM_TOP = ROW_PAD_Y + ICON_TOP + CHAT_ICON + 2;

/**
 * One dot, four meanings: amber and pulsing while an agent or planner
 * is working, an amber ring while the thread waits on you, a green
 * filled dot when a plan is done, grey when nothing is happening.
 * Chats never emit "done"; only plans can reach the green state.
 */
export function StateDot({ state, className }: { state: ControlPanelItemState; className?: string }) {
  const tone =
    state === "running"
      ? "working"
      : state === "done"
        ? "done"
        : NEEDS_YOU_STATES.has(state)
          ? "waiting"
          : "idle";
  const label =
    tone === "working"
      ? "Agent working"
      : tone === "waiting"
        ? "Waiting on you"
        : tone === "done"
          ? "Done"
          : "Nothing happening";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        tone === "working" && "animate-pulse bg-amber-500",
        tone === "waiting" && "border-2 border-amber-500 bg-transparent",
        tone === "done" && "bg-green-500",
        tone === "idle" && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

/** True when a key press or the focus belongs to a text field, menu or dialog, not the list. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.closest("[role='dialog'],[role='menu'],[role='listbox']") !== null
  );
}

export interface ControlPanelListProps {
  /** Searched, nested, day-grouped rows — built by the parent. */
  groups: ControlPanelGroup[];
  /** Unsearched item count, for the empty-state copy. */
  totalCount: number;
  loading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  /** Chats whose nested plans are showing; everything else is collapsed. */
  expandedKeys: ReadonlySet<string>;
  onToggleExpanded: (key: string) => void;
  /** Keyboard cursor (↑↓ / j k). */
  cursorKey: string | null;
  /** The thread currently on stage. */
  focusedKey: string | null;
  onOpen: (item: ControlPanelItem) => void;
  /** Chats the user has beyond the ones listed. */
  remaining: number;
  onShowMore: () => void;
}

/**
 * The control panel column: Jamie chats as the spine, a plan spawned
 * from a chat nested under it (collapsed until opened), all grouped by the day of
 * their newest activity. One row per thread with a "since you" line, a
 * time column and a state dot; a "Show N more" at the end when the org
 * has more chats than are listed. New chat lives in the chat's own
 * actions in the bar across the divider (`n` here does the same).
 */
export function ControlPanelList({
  groups,
  totalCount,
  loading,
  query,
  onQueryChange,
  expandedKeys,
  onToggleExpanded,
  cursorKey,
  focusedKey,
  onOpen,
  remaining,
  onShowMore,
}: ControlPanelListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const firstVisible = useMemo(
    () => groups.flatMap((g) => g.rows).find((r) => !(r.parentKey && !expandedKeys.has(r.parentKey))),
    [groups, expandedKeys],
  );
  // Rows only move when their order does; framer measures them only then.
  const rowOrder = useMemo(() => groups.flatMap((g) => g.rows.map((r) => r.item.key)).join("|"), [groups]);

  // Real DOM focus follows the keyboard cursor, so the browser's own
  // focus ring never lingers on the last clicked row — unless the user
  // is typing (the composer, search), which a list refresh must not
  // interrupt.
  useEffect(() => {
    if (!cursorKey) return;
    const el = document.querySelector<HTMLElement>(`[data-panel-key="${cursorKey}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    if (!isTypingTarget(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, [cursorKey]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    onQueryChange("");
    setSearchOpen(false);
  };

  return (
    <aside className="flex h-full w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-end border-b px-3">
        <ActionTip label="Search chats and plans">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search"
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            className={cn("h-7 w-7", searchOpen && "bg-muted")}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </ActionTip>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              } else if (e.key === "Enter" && firstVisible) {
                e.preventDefault();
                onOpen(firstVisible.item);
              }
            }}
            placeholder="Search chats and plans"
            aria-label="Search chats and plans"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <motion.div layoutScroll className="h-full overflow-y-auto pb-8">
          {loading && totalCount === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : !firstVisible ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {totalCount === 0
                ? `Nothing yet. Start a ${jamieName} chat and it lands here.`
                : "No chats or plans match."}
            </p>
          ) : (
            groups.flatMap((group) => [
              <h3
                key={`day:${group.key}`}
                className="sticky top-0 z-10 border-b bg-background/95 px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur"
              >
                {group.label}
              </h3>,
              ...group.rows.map(({ item, depth, parentKey, childCount, latestAt }, i) => {
                if (parentKey && !expandedKeys.has(parentKey)) return null;
                const { Icon, className: kindClass } = KIND[item.kind];
                const focused = item.key === focusedKey;
                const cursor = item.key === cursorKey;
                const collapsible = (childCount ?? 0) > 0;
                const collapsed = collapsible && !expandedKeys.has(item.key);
                const lastChild = group.rows[i + 1]?.parentKey !== parentKey;
                const meta = [item.workspaceName, item.sinceYou].filter(Boolean).join(" · ");
                return (
                  <motion.div
                    key={item.key}
                    layout="position"
                    layoutDependency={rowOrder}
                    transition={ROW_MOVE}
                    role="button"
                    tabIndex={0}
                    data-panel-key={item.key}
                    onClick={() => onOpen(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(item);
                      }
                    }}
                    aria-current={focused ? "true" : undefined}
                    style={{ paddingLeft: depth > 0 ? PLAN_ROW_PAD : CHAT_ROW_PAD }}
                    className={cn(
                      "relative flex w-full cursor-pointer items-start gap-2 border-b py-2.5 pr-3 text-left outline-none transition-colors",
                      focused ? "bg-muted" : "hover:bg-muted/60",
                      cursor && "ring-1 ring-inset ring-ring",
                    )}
                  >
                    {/* The tree: a stem from an open chat's icon, a guide down its plans, a tick into each. */}
                    {collapsible && !collapsed && (
                      <span
                        aria-hidden
                        className="absolute bottom-0 w-px bg-border"
                        style={{ left: GUIDE_LEFT, top: STEM_TOP }}
                      />
                    )}
                    {depth > 0 && (
                      <>
                        <span
                          aria-hidden
                          className="absolute top-0 w-px bg-border"
                          style={{ left: GUIDE_LEFT, ...(lastChild ? { height: ICON_CENTER_TOP } : { bottom: 0 }) }}
                        />
                        <span
                          aria-hidden
                          className="absolute h-px bg-border"
                          style={{ left: GUIDE_LEFT, width: PLAN_ROW_PAD - GUIDE_LEFT - 6, top: ICON_CENTER_TOP }}
                        />
                      </>
                    )}
                    {collapsible ? (
                      <button
                        type="button"
                        aria-label={collapsed ? "Show plans" : "Hide plans"}
                        aria-expanded={!collapsed}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleExpanded(item.key);
                        }}
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    ) : (
                      depth === 0 && <span className="w-4 shrink-0" aria-hidden />
                    )}
                    {/* Every chat row reserves the same slot for the count, so titles line up. */}
                    {depth === 0 && (
                      <span
                        className="mt-0.5 w-3 shrink-0 text-[10px] tabular-nums leading-4 text-muted-foreground"
                        title={collapsed ? `${childCount} plans` : undefined}
                      >
                        {collapsed ? childCount : ""}
                      </span>
                    )}
                    <Icon className={cn("mt-0.5 shrink-0", depth > 0 ? "h-3.5 w-3.5" : "h-4 w-4", kindClass)} />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate",
                          depth > 0 ? "text-[13px]" : "text-sm",
                          (item.unread || focused) && "font-semibold",
                        )}
                      >
                        {item.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{meta}</div>
                    </div>
                    <div className="flex w-14 shrink-0 flex-col items-end gap-1.5">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatAge(Date.now() - Date.parse(latestAt))}
                      </span>
                      <StateDot state={item.state} />
                    </div>
                  </motion.div>
                );
              }),
            ])
          )}
          {firstVisible && remaining > 0 && (
            <button
              type="button"
              onClick={onShowMore}
              className="w-full px-3 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Show {Math.min(remaining, CONTROL_PANEL_PAGE)} more
            </button>
          )}
        </motion.div>
        {firstVisible && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
          />
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <Kbd>↑↓</Kbd> move
        <Kbd>⏎</Kbd> open
        <Kbd>n</Kbd> new chat
      </div>
    </aside>
  );
}
