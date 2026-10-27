"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { ControlPanelGroup } from "@/services/orgs/control-panel-state";
import type { ControlPanelItem, ControlPanelJob, ControlPanelPullRequest } from "@/types/control-panel";
import type { PullRequestState } from "../../_state/canvasChatArtifacts";
import { ToolbarButton } from "../artifacts/chrome";
import { plural } from "../artifacts/lines";
import { PULL_REQUEST_STATE } from "../artifacts/viewers/pullRequest";

/** Keys typed into a field, a menu or a dialog are not the list's. */
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
  /** Searched, day-grouped chats — built by the parent. */
  groups: ControlPanelGroup[];
  /** Unsearched chat count, for the empty-state copy. */
  totalCount: number;
  loading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  /** Keyboard cursor (↑↓ / j k). */
  cursorId: string | null;
  /** The active chat. */
  activeId: string | null;
  onOpen: (item: ControlPanelItem) => void;
  /** A job opens its chat at the job's newest card. */
  onOpenJob: (item: ControlPanelItem, job: ControlPanelJob) => void;
  /** A pull request opens its chat with the PR on the artifact panel. */
  onOpenPullRequest: (item: ControlPanelItem, pr: ControlPanelPullRequest) => void;
  /** Chats the user has beyond the ones listed. */
  remaining: number;
  onShowMore: () => void;
  archivedItems: ControlPanelItem[];
  archivedExpanded: boolean;
  onToggleArchived: () => void;
  onArchive: (item: ControlPanelItem) => void;
  onRestore: (item: ControlPanelItem) => void;
  onRename: (item: ControlPanelItem, title: string) => void;
  onNewChat: () => void;
  onHide: () => void;
}

const MAX_CHAT_TITLE_LENGTH = 200;

const SUBTLE_ROW = "w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:text-foreground";

/** The glyph wears what still needs doing: any open PR reads as open, then draft, merged, closed. */
const GLYPH_ORDER: PullRequestState[] = ["open", "draft", "merged", "closed"];

/**
 * The org page's chat list: one row per Jamie chat, its title alone. Day
 * headers carry the time; the right edge carries only what is worth a
 * glance — Jamie working, the pull requests the chat's jobs reported. A
 * chat's jobs nest under it, the newest showing and the rest behind
 * "N more".
 */
export function ControlPanelList({
  groups,
  totalCount,
  loading,
  query,
  onQueryChange,
  cursorId,
  activeId,
  onOpen,
  onOpenJob,
  onOpenPullRequest,
  remaining,
  onShowMore,
  archivedItems,
  archivedExpanded,
  onToggleArchived,
  onArchive,
  onRestore,
  onRename,
  onNewChat,
  onHide,
}: ControlPanelListProps) {
  const [searching, setSearching] = useState(false);
  const closeSearch = () => {
    onQueryChange("");
    setSearching(false);
  };
  const rowProps = { cursorId, activeId, onOpen, onOpenJob, onOpenPullRequest, onRename };
  const empty = groups.length === 0;

  return (
    <section aria-label="Chats" className="flex h-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b pl-3 pr-2">
        {searching ? (
          <>
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onBlur={() => !query && setSearching(false)}
              onKeyDown={(e) => e.key === "Escape" && closeSearch()}
              placeholder="Search chats"
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <ToolbarButton label="Clear search" onClick={closeSearch}>
              <X className="h-4 w-4" />
            </ToolbarButton>
          </>
        ) : (
          <>
            <h2 className="text-sm font-medium">Chats</h2>
            <div className="ml-auto flex items-center">
              <ToolbarButton label="Search chats" onClick={() => setSearching(true)}>
                <Search className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton label="New chat" onClick={onNewChat}>
                <SquarePen className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton label="Hide chats" onClick={onHide}>
                <PanelLeftClose className="h-4 w-4" />
              </ToolbarButton>
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {empty && (
          <div className="px-2 py-6 text-sm text-muted-foreground">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading chats" />
            ) : query && totalCount > 0 ? (
              "No chats match."
            ) : (
              "No chats yet."
            )}
          </div>
        )}

        {groups.map((group) => (
          <DayGroup key={group.key} label={group.label}>
            {group.items.map((item) => (
              <ChatRow
                key={item.id}
                item={item}
                {...rowProps}
                actions={[
                  { label: "Rename", Icon: Pencil, onSelect: "rename" },
                  { label: "Archive", Icon: Archive, onSelect: onArchive },
                ]}
              />
            ))}
          </DayGroup>
        ))}

        {remaining > 0 && !query && (
          <button type="button" onClick={onShowMore} className={cn(SUBTLE_ROW, "mt-1")}>
            Show more
          </button>
        )}

        {archivedItems.length > 0 && (
          <DayGroup label="Archived" expanded={archivedExpanded} onToggle={onToggleArchived}>
            {archivedItems.map((item) => (
              <ChatRow
                key={item.id}
                item={item}
                {...rowProps}
                actions={[
                  { label: "Rename", Icon: Pencil, onSelect: "rename" },
                  { label: "Restore", Icon: ArchiveRestore, onSelect: onRestore },
                ]}
              />
            ))}
          </DayGroup>
        )}
      </div>
    </section>
  );
}

/** Chats under a label — a day, or Archived — that folds them away; Archived's fold is the parent's. */
function DayGroup({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const [ownExpanded, setOwnExpanded] = useState(true);
  const open = expanded ?? ownExpanded;
  return (
    <section className="pt-3">
      <button
        type="button"
        onClick={onToggle ?? (() => setOwnExpanded((o) => !o))}
        aria-expanded={open}
        className="group flex items-center gap-1 px-2 pb-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {label}
        {open ? (
          <ChevronDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>
      {open && children}
    </section>
  );
}

interface RowProps {
  cursorId: string | null;
  activeId: string | null;
  onOpen: (item: ControlPanelItem) => void;
  onOpenJob: (item: ControlPanelItem, job: ControlPanelJob) => void;
  onOpenPullRequest: (item: ControlPanelItem, pr: ControlPanelPullRequest) => void;
  onRename: (item: ControlPanelItem, title: string) => void;
}

/** A chat, and the jobs it started under a guide line: the newest one, the rest behind "N more". */
function ChatRow({
  item,
  cursorId,
  activeId,
  onOpen,
  onOpenJob,
  onOpenPullRequest,
  onRename,
  actions,
}: RowProps & {
  item: ControlPanelItem;
  actions: { label: string; Icon: typeof Archive; onSelect: "rename" | ((item: ControlPanelItem) => void) }[];
}) {
  const [editing, setEditing] = useState(false);
  // Radix returns focus to the menu trigger on close, which would blur the rename input and end editing.
  const renameRequestedRef = useRef(false);
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const jobs = jobsExpanded ? item.jobs : item.jobs.slice(0, 1);
  const hiddenJobs = item.jobs.length - jobs.length;
  const openPr = (pr: ControlPanelPullRequest) => onOpenPullRequest(item, pr);

  return (
    <div data-testid="chat-list-item" data-chat-id={item.id}>
      <Row
        title={item.title}
        editing={editing}
        onRename={(next) => {
          setEditing(false);
          if (next !== null && next !== item.title) onRename(item, next);
        }}
        active={item.id === activeId}
        cursor={item.id === cursorId}
        working={item.working}
        pullRequests={item.pullRequests}
        onOpen={() => onOpen(item)}
        onOpenPullRequest={openPr}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chat actions"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                if (renameRequestedRef.current) {
                  e.preventDefault();
                  renameRequestedRef.current = false;
                }
              }}
            >
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={() => {
                    if (action.onSelect === "rename") {
                      renameRequestedRef.current = true;
                      setEditing(true);
                    } else action.onSelect(item);
                  }}
                >
                  <action.Icon />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {item.jobs.length > 0 && (
        <div className="ml-3 border-l pl-2">
          {jobs.map((job) => (
            <Row
              key={job.id}
              title={job.title}
              working={job.working}
              pullRequests={item.pullRequests.filter((pr) => pr.jobId === job.id)}
              onOpen={() => onOpenJob(item, job)}
              onOpenPullRequest={openPr}
            />
          ))}
          {hiddenJobs > 0 && (
            <button type="button" onClick={() => setJobsExpanded(true)} className={SUBTLE_ROW}>
              {hiddenJobs} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  title,
  active = false,
  cursor = false,
  working,
  pullRequests,
  onOpen,
  onOpenPullRequest,
  menu,
  editing = false,
  onRename,
}: {
  title: string;
  editing?: boolean;
  onRename?: (title: string | null) => void;
  active?: boolean;
  cursor?: boolean;
  working: boolean;
  pullRequests: ControlPanelPullRequest[];
  onOpen: () => void;
  onOpenPullRequest: (pr: ControlPanelPullRequest) => void;
  menu?: React.ReactNode;
}) {
  // The keyboard cursor never leaves the list's view.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cursor) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  // The title is the row's button, stretched over the whole row; the PRs and
  // the menu sit above it as siblings, so their clicks never open the chat.
  return (
    <div
      ref={rowRef}
      className={cn(
        "group relative flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
        active
          ? "bg-muted text-foreground"
          : cn("text-foreground/80 hover:bg-muted/60 hover:text-foreground", cursor && "bg-muted/40"),
      )}
    >
      {editing && onRename ? (
        <RenameInput initial={title} onDone={onRename} />
      ) : (
        <button
          type="button"
          title={title}
          onClick={onOpen}
          aria-current={active ? "page" : undefined}
          className="min-w-0 flex-1 truncate text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-1 focus-visible:after:ring-ring"
        >
          {title}
        </button>
      )}
      {/* Two fixed slots, so nothing on the right ever moves: the PRs, then
        the status — Jamie working, else empty — which turns into the menu
        on hover. */}
      <span className="relative z-10 flex w-8 shrink-0 justify-end text-xs text-muted-foreground">
        {pullRequests.length > 0 && <PullRequestGlyph pullRequests={pullRequests} onOpen={onOpenPullRequest} />}
      </span>
      <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
        {working && (
          <span
            role="status"
            aria-label="Working"
            className={cn(
              "h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60",
              menu && "group-focus-within:hidden group-hover:hidden group-has-[[data-state=open]]:hidden",
            )}
          />
        )}
        {menu && (
          <span className="absolute inset-0 hidden items-center justify-center group-hover:flex group-focus-within:flex has-[[data-state=open]]:flex">
            {menu}
          </span>
        )}
      </span>
    </div>
  );
}

/** Inline title editor: Enter / blur save, Escape cancels, a blank title cancels. */
function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = value.trim();
    onDone(save && trimmed ? trimmed.slice(0, MAX_CHAT_TITLE_LENGTH) : null);
  };
  return (
    <input
      ref={inputRef}
      autoFocus
      aria-label="Chat title"
      value={value}
      maxLength={MAX_CHAT_TITLE_LENGTH}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
        e.stopPropagation();
      }}
      className="relative z-10 min-w-0 flex-1 rounded border bg-background px-1 text-sm outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

/** The PR glyph and count: hovering lists them, a click opens one on the artifact panel. */
function PullRequestGlyph({
  pullRequests,
  onOpen,
}: {
  pullRequests: ControlPanelPullRequest[];
  onOpen: (pr: ControlPanelPullRequest) => void;
}) {
  const lead = GLYPH_ORDER.find((state) => pullRequests.some((pr) => pr.state === state)) ?? "open";
  const { Icon, color } = PULL_REQUEST_STATE[lead];
  const count = pullRequests.length;
  return (
    <span className="flex">
      <HoverCard openDelay={150} closeDelay={100}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={plural(count, "pull request")}
            onClick={() => {
              if (count === 1) onOpen(pullRequests[0]);
            }}
            className="flex items-center gap-1 rounded px-0.5 hover:bg-muted"
          >
            <Icon className="h-3.5 w-3.5" style={{ color }} />
            {count > 1 && <span className="tabular-nums">{count}</span>}
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-80 p-1.5">
          {pullRequests.map((pr) => {
            const state = PULL_REQUEST_STATE[pr.state];
            return (
              <button
                key={pr.identity}
                type="button"
                onClick={() => onOpen(pr)}
                className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="block truncate text-sm">{pr.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <state.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: state.color }} />
                  <span style={{ color: state.color }}>{state.label}</span>
                  <span>·</span>
                  <span className="truncate">
                    {pr.repo} #{pr.number}
                  </span>
                </span>
              </button>
            );
          })}
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}
