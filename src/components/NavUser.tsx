"use client";

import {
  ChevronsUpDown,
  LogOut,
  Settings,
  Building2,
} from "lucide-react";

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
import { signOut } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";
//import { useRouter } from "next/navigation";
//import type { WorkspaceWithRole } from "@/types/workspace";

export function NavUser({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  const { isMobile } = useSidebar();
  //const { workspace, switchWorkspace } = useWorkspace();
  const { workspace } = useWorkspace();
  //const router = useRouter();

  // Get initials for fallback
  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length === 1) return parts[0][0];
    return parts[0][0] + parts[1][0];
  };

  //const handleWorkspaceSwitch = async (targetWorkspace: WorkspaceWithRole) => {
  //  await switchWorkspace(targetWorkspace);
  //  router.push(`/w/${targetWorkspace.slug}`);
  //};

  //const handleViewAllWorkspaces = () => {
  //  router.push("/workspaces");
  //};

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

            {/* Current Workspace Section */}
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

            {/* Hidden for now: Upgrade to Pro, Account, Billing, Notifications */}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/settings">
                <Settings />
                Account Settings
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/", redirect: true })}
              data-testid="logout-button"
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
