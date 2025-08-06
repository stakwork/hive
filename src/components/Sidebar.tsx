"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Home, Settings, Menu, CheckSquare, Network } from "lucide-react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NavUser } from "./NavUser";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { useWorkspace } from "@/hooks/useWorkspace";

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    github?: {
      username?: string;
      publicRepos?: number;
      followers?: number;
    };
  };
}

const navigationItems = [
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  // { icon: Map, label: "Roadmap", href: "/roadmap" },
  { icon: Network, label: "Stakgraph", href: "/stakgraph" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

export function Sidebar({ user }: SidebarProps) {
  const router = useRouter();
  const {
    slug: workspaceSlug,
    switchWorkspace,
    refreshWorkspaces,
    getWorkspaceBySlug,
  } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const pathname = usePathname();
  const isTaskPage = pathname.includes("/task/");

  const handleWorkspaceChange = () => {
    // Optionally implement logic if needed
  };

  const handleCreateWorkspace = () => {
    setCreateDialogOpen(true);
  };

  const handleWorkspaceCreated = async (createdWorkspace: { slug: string }) => {
    setCreateDialogOpen(false);
    await refreshWorkspaces();
    const newWorkspace = getWorkspaceBySlug(createdWorkspace.slug);
    if (newWorkspace) {
      switchWorkspace(newWorkspace); // This will handle navigation
    } else {
      // Fallback: route directly if not found (shouldn't happen)
      router.push(`/w/${createdWorkspace.slug}`);
    }
  };

  const handleNavigate = (href: string) => {
    if (workspaceSlug) {
      const fullPath =
        href === "" ? `/w/${workspaceSlug}` : `/w/${workspaceSlug}${href}`;
      router.push(fullPath);
    } else {
      // Fallback to workspaces page if no workspace detected
      router.push("/workspaces");
    }
    setIsOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Workspace Switcher */}
      <WorkspaceSwitcher
        onWorkspaceChange={handleWorkspaceChange}
        onCreateWorkspace={handleCreateWorkspace}
      />
      <CreateWorkspaceDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleWorkspaceCreated}
      />
      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigationItems.map((item) => (
            <li key={item.href}>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => handleNavigate(item.href)}
              >
                <item.icon className="w-4 h-4 mr-2" />
                {item.label}
              </Button>
            </li>
          ))}
        </ul>
      </nav>
      <Separator />
      {/* User Popover */}
      <div className="p-4">
        <NavUser
          user={{
            name: user.name || "User",
            email: user.email || "",
            avatar: user.image || "",
          }}
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Sidebar */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={
              isTaskPage ? "flex items-center justify-center absolute left-3 top-2 z-50" : "md:hidden"
            }
          >
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-80 p-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>
      {/* Desktop Sidebar */}
      <div
        className={`${isTaskPage ? "hidden" : "hidden md:flex"} md:w-80 md:flex-col md:fixed md:inset-y-0 md:z-50`}
      >
        <div className="flex flex-col flex-grow bg-sidebar border-sidebar-border border-r">
          <SidebarContent />
        </div>
      </div>
    </>
  );
}
