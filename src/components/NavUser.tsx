"use client";

import React, { useState, useEffect } from "react";
import {
  ChevronsUpDown,
  LogOut,
  Settings,
  Building2,
  Zap,
  Activity,
} from "lucide-react";
import Link from "next/link";
import type { OrgResponse } from "@/types/workspace";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { signOut, useSession } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SphinxLinkModal } from "@/components/SphinxLinkModal";

export function NavUser({
  user,
  variant = "default",
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
  variant?: "default" | "compact";
}) {
  const { isMobile } = useSidebar();
  const { data: session } = useSession();
  const [showSphinxModal, setShowSphinxModal] = useState(false);
  const [orgs, setOrgs] = useState<OrgResponse[]>([]);

  useEffect(() => {
    fetch("/api/orgs")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setOrgs(data))
      .catch(() => {});
  }, []);

  const { workspace } = useWorkspace();

  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length === 1) return parts[0][0];
    return parts[0][0] + parts[1][0];
  };

  const menuItems = (
    <>
      <DropdownMenuLabel className="p-0 font-normal">
        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="rounded-lg">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight min-w-0">
            <span className="truncate font-medium">{user.name}</span>
          </div>
        </div>
      </DropdownMenuLabel>

      {workspace && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Current Workspace
          </DropdownMenuLabel>
          <DropdownMenuItem className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{workspace.name}</div>
            </div>
          </DropdownMenuItem>
        </>
      )}

      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/profile" className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          My Activity
        </Link>
      </DropdownMenuItem>

      {orgs.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Organizations
          </DropdownMenuLabel>
          {orgs.map((org) => (
            <DropdownMenuItem key={org.id} asChild>
              <Link href={`/org/${org.githubLogin}`} className="flex items-center gap-2">
                <Avatar className="h-4 w-4 rounded-sm">
                  <AvatarImage
                    src={org.avatarUrl ?? undefined}
                    alt={org.name ?? org.githubLogin}
                  />
                  <AvatarFallback className="rounded-sm text-[10px]">
                    {(org.name ?? org.githubLogin)[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{org.name ?? org.githubLogin}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </>
      )}

      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <a href="/settings">
          <Settings />
          Account Settings
        </a>
      </DropdownMenuItem>

      {!session?.user?.lightningPubkey && (
        <DropdownMenuItem onClick={() => setShowSphinxModal(true)}>
          <Zap className="h-4 w-4" />
          Link Sphinx
        </DropdownMenuItem>
      )}

      <DropdownMenuItem
        onClick={() => signOut({ callbackUrl: "/", redirect: true })}
        data-testid="user-menu-logout"
      >
        <LogOut />
        Log out
      </DropdownMenuItem>
    </>
  );

  if (variant === "compact") {
    return (
      <>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center justify-center w-10 h-10 rounded-md transition-colors hover:bg-muted/60"
                  data-testid="user-menu-trigger"
                  aria-label="User menu"
                >
                  <Avatar className="h-7 w-7 rounded-lg">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="rounded-lg text-xs">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              Account
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={4}
            data-testid="dropdown-content"
          >
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>

        <SphinxLinkModal open={showSphinxModal} onOpenChange={setShowSphinxModal} />
      </>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="user-menu-trigger"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight min-w-0">
                <span className="truncate font-medium">{user.name}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <SphinxLinkModal open={showSphinxModal} onOpenChange={setShowSphinxModal} />
    </SidebarMenu>
  );
}
