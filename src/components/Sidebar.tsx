"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  BarChart3,
  BookOpen,
  CheckSquare,
  Map,
  Menu,
  Phone,
  Settings,
  Users,
} from "lucide-react";
import { PiGraphFill } from "react-icons/pi";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { NavUser } from "./NavUser";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";



export function scopedPath(pathname: string): string {
  const m = pathname.match(/^\/w\/[^/]+(\/.*)?$/);
  return m ? (m[1] || "/") : pathname;
}

export function isActiveTab(pathname: string, href: string): boolean {
  const rel = scopedPath(pathname);

  const cleanHref =
    !href || href === "/" ? "/" : `/${href.replace(/^\/|\/$/g, "")}`;
  const cleanRel =
    rel === "/" ? "/" : `/${rel.replace(/^\/|\/$/g, "")}`;

  if (cleanHref === "/") return cleanRel === "/";

  return cleanRel === cleanHref || cleanRel.startsWith(`${cleanHref}/`);
}

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

interface SidebarContentProps {
  navigationItems: typeof baseNavigationItems;
  pathname: string;
  handleNavigate: (href: string) => void;
  tasksWaitingForInputCount: number;
  user: SidebarProps['user'];
}

const baseNavigationItems = [
  { icon: PiGraphFill, label: "Graph", href: "/" },
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  { icon: Map, label: "Roadmap", href: "/roadmap" },
  { icon: BarChart3, label: "Insights", href: "/insights" },
  { icon: Users, label: "User Journeys", href: "/user-journeys" },
  { icon: BookOpen, label: "Learn", href: "/learn" },
  { icon: Phone, label: "Calls", href: "/calls" },
  // { icon: Settings, label: "Settings", href: "/settings" },
];

function SidebarContent({
  navigationItems,
  pathname,
  handleNavigate,
  tasksWaitingForInputCount,
  user,
}: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Workspace Switcher */}
      <WorkspaceSwitcher onWorkspaceChange={() => null} />
      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigationItems.map((item) => {
            const isActive = isActiveTab(pathname, item.href);
            const isTasksItem = item.label === "Tasks";
            const showBadge = isTasksItem && tasksWaitingForInputCount > 0;

            return (
              <li key={item.href}>
                <Button
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  variant={isActive ? "secondary" : "ghost"}
                  className={`w-full justify-start ${isActive
                    ? "bg-primary/10 dark:bg-primary/20 hover:bg-primary/20 dark:hover:bg-primary/30"
                    : "hover:bg-primary/5 dark:hover:bg-primary/10"
                    }`}
                  onClick={() => handleNavigate(item.href)}
                >
                  <item.icon className="w-4 h-4 mr-2" />
                  {item.label}
                  {showBadge && (
                    <Badge className="ml-auto px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-200">
                      {tasksWaitingForInputCount}
                    </Badge>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Spacer to push bottom content down */}
      <div className="flex-1" />
      {/* Settings */}
      <div className="p-4 pb-2">
        <Button
          data-testid="settings-button"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => handleNavigate("/settings")}
        >
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </Button>
      </div>
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
}

export function Sidebar({ user }: SidebarProps) {
  const router = useRouter();
  const { slug: workspaceSlug, waitingForInputCount, refreshTaskNotifications } = useWorkspace();

  // Use global notification count from WorkspaceContext (not affected by pagination)
  const tasksWaitingForInputCount = waitingForInputCount;

  const canAccessInsights = useFeatureFlag(
    FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
  );

  const excludeLabels: string[] = [];
  if (!canAccessInsights) excludeLabels.push("Insights");

  const navigationItems = baseNavigationItems.filter(
    (item) => !excludeLabels.includes(item.label),
  );

  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const isTaskPage = pathname.includes("/task/");

  const handleNavigate = (href: string) => {
    // Refresh notification count when user clicks Tasks menu item
    if (href === "/tasks") {
      refreshTaskNotifications();
    }

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

  return (
    <>
      {/* Mobile Sidebar - Hidden on task pages since we have a back button */}
      {!isTaskPage && (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SidebarContent
              navigationItems={navigationItems}
              pathname={pathname}
              handleNavigate={handleNavigate}
              tasksWaitingForInputCount={tasksWaitingForInputCount}
              user={user}
            />
          </SheetContent>
        </Sheet>
      )}
      {/* Desktop Sidebar */}
      <div
        className={`${isTaskPage ? "hidden" : "hidden md:flex"} md:w-64 md:flex-col md:fixed md:inset-y-0 md:z-0`}
      >
        <div className="flex flex-col flex-grow bg-sidebar border-sidebar-border border-r">
          <SidebarContent
            navigationItems={navigationItems}
            pathname={pathname}
            handleNavigate={handleNavigate}
            tasksWaitingForInputCount={tasksWaitingForInputCount}
            user={user}
          />
        </div>
      </div>
    </>
  );
}
