"use client";

import Link from "next/link";
import {
  Network,
  Target,
  LayoutGrid,
  Users,
  GitBranch,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { OrgView } from "./useOrgView";

interface RailItem {
  view: OrgView;
  label: string;
  icon: LucideIcon;
  /** Path appended to `/org/{githubLogin}` to reach this view. */
  path: string;
}

const ITEMS: RailItem[] = [
  { view: "canvas", label: "Canvas", icon: Network, path: "" },
  { view: "initiatives", label: "Initiatives", icon: Target, path: "/initiatives" },
  { view: "workspaces", label: "Workspaces", icon: LayoutGrid, path: "/workspaces" },
  { view: "members", label: "Members", icon: Users, path: "/members" },
  { view: "schematic", label: "Schematic", icon: GitBranch, path: "/schematic" },
  { view: "graph", label: "Graph", icon: Workflow, path: "/graph" },
];

interface OrgRailProps {
  githubLogin: string;
  activeView: OrgView;
}

/**
 * Icon-only navigation rail for the org page. Tooltips on hover give
 * each icon a name without taking up horizontal space — the rail
 * stays narrow so the canvas (the default view) gets the real estate.
 */
export function OrgRail({ githubLogin, activeView }: OrgRailProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Org navigation"
        className="flex flex-col items-center gap-1 w-14 shrink-0 border-r bg-background py-3 z-30"
      >
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.view;
          return (
            <Tooltip key={item.view}>
              <TooltipTrigger asChild>
                <Link
                  href={`/org/${githubLogin}${item.path}`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-md transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
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
      </nav>
    </TooltipProvider>
  );
}
