"use client";

import Link from "next/link";
import {
  MessageSquare,
  Network,
  Blocks,
  ShieldCheck,
  Gauge,
  ArrowUpRight,
  Workflow,
  Settings,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { strutViewPath } from "@/lib/utils/strut-links";
import type { OrgView } from "./useOrgView";
import { NavUser } from "@/components/NavUser";

interface RailItem {
  view: OrgView;
  label: string;
  icon: LucideIcon;
  /** Appended to `/org/{githubLogin}` to reach this view (same tab). */
  path: string;
}

const TOP_ITEMS: RailItem[] = [
  { view: "chats", label: "Chats", icon: MessageSquare, path: "" },
  { view: "canvas", label: "Canvas", icon: Network, path: "?view=canvas" },
  { view: "graph", label: "Graph", icon: Workflow, path: "?view=graph" },
];

interface OrgRailProps {
  githubLogin: string;
  activeView: OrgView;
  user: { name: string; email: string; avatar: string };
  org: { name: string; avatarUrl: string | null };
}

function itemClass(isActive: boolean) {
  return cn(
    "flex items-center justify-center w-10 h-10 rounded-md transition-colors",
    isActive
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );
}

/**
 * Icon-only navigation rail for the org page. Tooltips on hover give
 * each icon a name without taking up horizontal space — the rail
 * stays narrow so the chat (the default view) gets the real estate.
 */
export function OrgRail({ githubLogin, activeView, user, org }: OrgRailProps) {
  const base = `/org/${githubLogin}`;

  const link = (item: RailItem) => {
    const Icon = item.icon;
    const isActive = activeView === item.view;
    return (
      <Tooltip key={item.view}>
        <TooltipTrigger asChild>
          <Link
            href={`${base}${item.path}`}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={itemClass(isActive)}
          >
            <Icon className="h-5 w-5" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Org navigation"
        className="flex flex-col items-center gap-1 w-14 shrink-0 border-r bg-background py-3 z-30 h-full"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href={`${base}/settings`} aria-label={`${org.name} settings`}>
              <Avatar className="h-8 w-8 rounded-md">
                <AvatarImage src={org.avatarUrl ?? undefined} alt={org.name} />
                <AvatarFallback className="rounded-md text-sm font-semibold">
                  {org.name[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            {org.name}
          </TooltipContent>
        </Tooltip>
        <div className="w-8 border-t my-1" />

        {TOP_ITEMS.map(link)}

        {/* Strut opens Hive's own strut page in a new tab. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={strutViewPath(githubLogin)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Strut"
              aria-current={activeView === "strut" ? "page" : undefined}
              className={itemClass(activeView === "strut")}
            >
              <Blocks className="h-5 w-5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            Strut
          </TooltipContent>
        </Tooltip>

        {/* Ops: plain <a>s (not next/link) — a prefetch would mint a single-use Gateway ticket. */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Ops" className={itemClass(false)}>
                  <Gauge className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              Ops
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem asChild>
              <a href={`${base}/gateway`} target="_blank" rel="noopener noreferrer">
                <Gauge className="h-4 w-4" />
                Gateway
                <ArrowUpRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`${base}/advisor`} target="_blank" rel="noopener noreferrer">
                <ShieldCheck className="h-4 w-4" />
                Advisor
                <ArrowUpRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {link({ view: "settings", label: "Settings", icon: Settings, path: "/settings" })}

        {/* Bottom: user avatar / profile menu */}
        <div className="mt-auto">
          <NavUser user={user} variant="compact" />
        </div>
      </nav>
    </TooltipProvider>
  );
}
