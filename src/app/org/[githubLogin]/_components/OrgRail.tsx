"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Blocks,
  Gauge,
  Map as MapIcon,
  MessageSquare,
  Settings,
  ShieldCheck,
  Waypoints,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { strutViewPath } from "@/lib/utils/strut-links";
import type { OrgView } from "./useOrgView";
import { NavUser } from "@/components/NavUser";

interface RailLink {
  view: OrgView;
  label: string;
  icon: LucideIcon;
  /** Appended to `/org/{githubLogin}`. */
  path: string;
}

const LINKS: RailLink[] = [
  { view: "chats", label: "Chats", icon: MessageSquare, path: "" },
  { view: "canvas", label: "Canvas", icon: MapIcon, path: "?view=canvas" },
  { view: "graph", label: "Graph", icon: Waypoints, path: "?view=graph" },
];

const ITEM_CLASS = "flex items-center justify-center w-10 h-10 rounded-md transition-colors";
const activeClass = (isActive: boolean) =>
  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground";

interface OrgRailProps {
  githubLogin: string;
  activeView: OrgView;
  org: { name: string; avatarUrl: string | null };
  user: { name: string; email: string; avatar: string };
}

/**
 * Icon-only navigation rail for the org page. Tooltips on hover give
 * each icon a name without taking up horizontal space — the rail
 * stays narrow so the chat (the default view) gets the real estate.
 */
export function OrgRail({ githubLogin, activeView, org, user }: OrgRailProps) {
  const base = `/org/${githubLogin}`;
  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Org navigation"
        className="flex flex-col items-center gap-1 w-14 shrink-0 border-r bg-background py-3 z-30 h-full"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={`${base}/settings`}
              aria-label={`${org.name} settings`}
              className="mb-2 flex items-center justify-center"
            >
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

        {LINKS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.view;
          return (
            <Tooltip key={item.view}>
              <TooltipTrigger asChild>
                <Link
                  href={`${base}${item.path}`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(ITEM_CLASS, activeClass(isActive))}
                >
                  <Icon className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={strutViewPath(githubLogin)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Strut"
              className={cn(ITEM_CLASS, activeClass(activeView === "strut"))}
            >
              <Blocks className="h-5 w-5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            Strut ↗
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Ops"
                  aria-current={activeView === "ops" ? "page" : undefined}
                  className={cn(ITEM_CLASS, activeClass(activeView === "ops"))}
                >
                  <Wrench className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              Ops
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="start">
            {/* New tab, as before (Hive's iframe pages). Plain anchors: no prefetch. */}
            <DropdownMenuItem asChild>
              <a href={`${base}/gateway`} target="_blank" rel="noopener noreferrer">
                <Gauge className="h-4 w-4" />
                <span className="flex-1">Gateway</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`${base}/advisor`} target="_blank" rel="noopener noreferrer">
                <ShieldCheck className="h-4 w-4" />
                <span className="flex-1">Advisor</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Bottom: settings cog, then user avatar / profile menu */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`${base}/settings`}
                aria-label="Settings"
                aria-current={activeView === "settings" ? "page" : undefined}
                className={cn(ITEM_CLASS, activeClass(activeView === "settings"))}
              >
                <Settings className="h-5 w-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              Settings
            </TooltipContent>
          </Tooltip>
          <NavUser user={user} variant="compact" />
        </div>
      </nav>
    </TooltipProvider>
  );
}
