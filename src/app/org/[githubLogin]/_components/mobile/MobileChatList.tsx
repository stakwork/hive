"use client";

import React from "react";
import { useState } from "react";
import { ArchiveRestore, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ControlPanelItem, ControlPanelJob, ControlPanelPullRequest } from "@/types/control-panel";
import type { ControlPanelListProps } from "../control-panel/ControlPanelList";
import { PULL_REQUEST_STATE } from "../artifacts/viewers/pullRequest";

const ROW = "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[15px] active:bg-muted";

function WorkingDot() {
  return (
    <span
      role="status"
      aria-label="Working"
      className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary"
    />
  );
}

/** A pull request as a row of its own: no hover card on a phone. */
function PullRequestRow({ pr, onOpen }: { pr: ControlPanelPullRequest; onOpen: () => void }) {
  const state = PULL_REQUEST_STATE[pr.state];
  return (
    <button type="button" data-testid="mobile-pr-row" onClick={onOpen} className={cn(ROW, "text-sm")}>
      <state.Icon className="h-4 w-4 shrink-0" style={{ color: state.color }} />
      <span className="min-w-0 flex-1 truncate">{pr.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">#{pr.number}</span>
    </button>
  );
}

type RowHandlers = Pick<ControlPanelListProps, "activeId" | "onOpen" | "onOpenJob" | "onOpenPullRequest">;

/** A chat with its jobs (the newest, the rest behind "N more") and the pull requests nested under it. */
function ChatItem({ item, activeId, onOpen, onOpenJob, onOpenPullRequest, trailing }: RowHandlers & {
  item: ControlPanelItem;
  trailing?: React.ReactNode;
}) {
  const [jobsExpanded, setJobsExpanded] = useState(false);
  const jobs: ControlPanelJob[] = jobsExpanded ? item.jobs : item.jobs.slice(0, 1);
  const hiddenJobs = item.jobs.length - jobs.length;
  const jobIds = new Set(item.jobs.map((j) => j.id));
  const chatPrs = item.pullRequests.filter((pr) => !pr.jobId || !jobIds.has(pr.jobId));
  const active = item.id === activeId;
  return (
    <div data-testid="chat-list-item" data-chat-id={item.id}>
      <div className={cn("flex items-center rounded-lg", active && "bg-muted")}>
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-current={active ? "page" : undefined}
          className={cn(ROW, "flex-1 font-medium", !active && "font-normal")}
        >
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
          {item.working && <WorkingDot />}
        </button>
        {trailing}
      </div>
      {(item.jobs.length > 0 || chatPrs.length > 0) && (
        <div className="ml-4 border-l pl-1">
          {jobs.map((job) => (
            <div key={job.id}>
              <button type="button" onClick={() => onOpenJob(item, job)} className={cn(ROW, "text-sm text-foreground/80")}>
                <span className="min-w-0 flex-1 truncate">{job.title}</span>
                {job.working && <WorkingDot />}
              </button>
              {item.pullRequests
                .filter((pr) => pr.jobId === job.id)
                .map((pr) => (
                  <PullRequestRow key={pr.identity} pr={pr} onOpen={() => onOpenPullRequest(item, pr)} />
                ))}
            </div>
          ))}
          {hiddenJobs > 0 && (
            <button
              type="button"
              onClick={() => setJobsExpanded(true)}
              className={cn(ROW, "text-sm text-muted-foreground")}
            >
              {hiddenJobs} more
            </button>
          )}
          {chatPrs.map((pr) => (
            <PullRequestRow key={pr.identity} pr={pr} onOpen={() => onOpenPullRequest(item, pr)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The drawer's chat list: the control panel's own groups and rows, drawn for
 * a thumb — 44px rows, nothing behind a hover, pull requests as nested rows.
 */
export function MobileChatList({ list }: { list: ControlPanelListProps }) {
  const { groups, totalCount, loading, query, remaining, archivedItems, archivedExpanded } = list;
  const handlers: RowHandlers = {
    activeId: list.activeId,
    onOpen: list.onOpen,
    onOpenJob: list.onOpenJob,
    onOpenPullRequest: list.onOpenPullRequest,
  };
  return (
    <div data-testid="mobile-chat-list" className="px-2 pb-3">
      {groups.length === 0 && (
        <div className="px-3 py-6 text-sm text-muted-foreground">
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
        <section key={group.key} className="pt-3">
          <h3 className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
          {group.items.map((item) => (
            <ChatItem key={item.id} item={item} {...handlers} />
          ))}
        </section>
      ))}
      {remaining > 0 && !query && (
        <button type="button" onClick={list.onShowMore} className={cn(ROW, "mt-1 text-muted-foreground")}>
          Show more
        </button>
      )}
      {archivedItems.length > 0 && (
        <section className="pt-3">
          <button
            type="button"
            onClick={list.onToggleArchived}
            aria-expanded={archivedExpanded}
            className="flex min-h-11 items-center gap-1 px-3 text-xs font-medium text-muted-foreground"
          >
            Archived
            {archivedExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {archivedExpanded &&
            archivedItems.map((item) => (
              <ChatItem
                key={item.id}
                item={item}
                {...handlers}
                trailing={
                  <button
                    type="button"
                    aria-label={`Restore ${item.title}`}
                    onClick={() => list.onRestore(item)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </button>
                }
              />
            ))}
        </section>
      )}
    </div>
  );
}
