"use client";

import React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Blocks,
  Check,
  ChevronsUpDown,
  Gauge,
  Map as MapIcon,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavUser } from "@/components/NavUser";
import { cn } from "@/lib/utils";
import { strutViewPath } from "@/lib/utils/strut-links";
import type { OrgResponse } from "@/types/workspace";
import type { ControlPanelItem, ControlPanelJob, ControlPanelPullRequest } from "@/types/control-panel";
import type { ControlPanelListProps } from "../control-panel/ControlPanelList";
import type { OrgView } from "../useOrgView";
import { MobileChatList } from "./MobileChatList";

const NAV_ROW =
  "flex min-h-12 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors active:bg-muted";

interface NavLink {
  view: OrgView;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Opens in a new tab (the iframe pages). */
  external?: boolean;
}

interface MobileOrgDrawerProps {
  githubLogin: string;
  /** The chat list's state (`useControlPanel`), held by the shell. */
  list: Omit<ControlPanelListProps, "onHide">;
  org: { name: string; avatarUrl: string | null };
  user: { name: string; email: string; avatar: string };
  /** Which view the page is on; chats can be opened in place only on "chats". */
  activeView: OrgView;
  open: boolean;
  onClose: () => void;
}

/**
 * The mobile shell's left drawer, standing in for the rail and the chat list:
 * org switcher, chat search, the views, the chats, and — at the bottom, in
 * thumb's reach — Settings, the account menu and New chat. Always mounted so
 * the chat list is warm when it opens; closed, it is inert and off screen.
 */
export function MobileOrgDrawer({ githubLogin, list, org, user, activeView, open, onClose }: MobileOrgDrawerProps) {
  const base = `/org/${githubLogin}`;
  const inChats = activeView === "chats";

  // A chat opens in place on the chats view; elsewhere the page has no chat to
  // open it in, so go to the chats view with it (a plain load, as the rail's links do).
  const go = (href: string) => window.location.assign(href);
  const openChat = (item: ControlPanelItem) => {
    if (!inChats) return go(`${base}?chat=${item.id}`);
    list.onOpen(item);
    onClose();
  };
  const openJob = (item: ControlPanelItem, job: ControlPanelJob) => {
    if (!inChats) return go(`${base}?chat=${item.id}`);
    void list.onOpenJob(item, job);
    onClose();
  };
  const openPr = (item: ControlPanelItem, pr: ControlPanelPullRequest) => {
    if (!inChats) return go(`${base}?chat=${item.id}`);
    void list.onOpenPullRequest(item, pr);
    onClose();
  };
  const newChat = () => {
    if (!inChats) return go(base);
    list.onNewChat();
    onClose();
  };

  const links: NavLink[] = [
    { view: "canvas", label: "Canvas", icon: MapIcon, href: `${base}?view=canvas` },
    { view: "graph", label: "Graph", icon: Waypoints, href: `${base}?view=graph` },
    // Full screen in this tab: a phone has no use for a second one.
    { view: "strut", label: "Strut", icon: Blocks, href: strutViewPath(githubLogin) },
    { view: "ops", label: "Gateway", icon: Gauge, href: `${base}/gateway`, external: true },
    { view: "ops", label: "Advisor", icon: ShieldCheck, href: `${base}/advisor`, external: true },
  ];

  return (
    <div
      data-testid="mobile-org-drawer-root"
      className={cn("fixed inset-0 z-50", !open && "pointer-events-none")}
      aria-hidden={!open}
      inert={!open}
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-black/50"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        data-testid="mobile-org-drawer-backdrop"
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        data-testid="mobile-org-drawer"
        className="absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col bg-background shadow-xl pt-[env(safe-area-inset-top)]"
        initial={false}
        animate={{ x: open ? 0 : "-100%" }}
        transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -400) onClose();
        }}
      >
        <TooltipProvider delayDuration={200}>
          <OrgSwitcher githubLogin={githubLogin} org={org} open={open} />

          <div className="px-3 pb-2">
            <label className="flex h-11 items-center gap-2 rounded-lg bg-muted px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="search"
                data-testid="mobile-chat-search"
                value={list.query}
                onChange={(e) => list.onQueryChange(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>

          <nav aria-label="Org navigation" className="px-2">
            {links.map((item) => {
              const Icon = item.icon;
              const current = !item.external && activeView === item.view;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  aria-current={current ? "page" : undefined}
                  className={cn(NAV_ROW, current && "bg-muted font-medium")}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1">{item.label}</span>
                  {item.external && <ArrowUpRight className="h-4 w-4 text-muted-foreground" />}
                </a>
              );
            })}
          </nav>

          <div className="mx-4 my-2 border-t" />

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <MobileChatList
              list={{ ...list, onHide: () => {}, onOpen: openChat, onOpenJob: openJob, onOpenPullRequest: openPr, onNewChat: newChat }}
            />
          </div>

          <div className="flex items-center gap-2 border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            <Link
              href={`${base}/settings`}
              aria-label="Settings"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
            >
              <Settings className="h-5 w-5" />
            </Link>
            <NavUser user={user} variant="compact" />
            <button
              type="button"
              data-testid="mobile-drawer-new-chat"
              onClick={newChat}
              className="ml-auto flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[15px] font-medium text-primary-foreground active:opacity-90"
            >
              <SquarePen className="h-4 w-4" />
              New chat
            </button>
          </div>
        </TooltipProvider>
      </motion.aside>
    </div>
  );
}

/** The current org, and — tapped — the orgs the user belongs to (the list NavUser's menu draws from). */
function OrgSwitcher({
  githubLogin,
  org,
  open,
}: {
  githubLogin: string;
  org: { name: string; avatarUrl: string | null };
  open: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [orgs, setOrgs] = useState<OrgResponse[] | null>(null);

  // Fetched once, the first time the drawer is opened.
  useEffect(() => {
    if (!open || orgs) return;
    fetch("/api/orgs")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: OrgResponse[]) => setOrgs(Array.isArray(data) ? data : []))
      .catch(() => setOrgs([]));
  }, [open, orgs]);

  return (
    <div className="px-2 pb-2 pt-2">
      <button
        type="button"
        data-testid="mobile-org-switcher"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 pr-12 text-left active:bg-muted"
      >
        <Avatar className="h-8 w-8 rounded-md">
          <AvatarImage src={org.avatarUrl ?? undefined} alt={org.name} />
          <AvatarFallback className="rounded-md text-sm font-semibold">{org.name[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{org.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {expanded && (
        <ul className="mt-1 rounded-lg border bg-muted/30 p-1">
          {(orgs ?? []).map((o) => {
            const name = o.name ?? o.githubLogin;
            return (
              <li key={o.id}>
                <a
                  href={`/org/${o.githubLogin}`}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 text-[15px] active:bg-muted"
                >
                  <Avatar className="h-6 w-6 rounded-sm">
                    <AvatarImage src={o.avatarUrl ?? undefined} alt={name} />
                    <AvatarFallback className="rounded-sm text-[10px]">{name[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {o.githubLogin === githubLogin && <Check className="h-4 w-4 text-primary" />}
                </a>
              </li>
            );
          })}
          {orgs?.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No other organizations.</li>}
        </ul>
      )}
    </div>
  );
}
