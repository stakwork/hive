"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Brain,
  Bug,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  Map,
  Menu,
  PenLine,
  Phone,
  Server,
  Settings,
  ShieldCheck,
  TestTube2,
  Workflow,
} from "lucide-react";
import { PiGraphFill } from "react-icons/pi";
import { usePathname, useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePoolStatus } from "@/hooks/usePoolStatus";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { SIDEBAR_WIDTH } from "@/lib/constants";
import { isDevelopmentMode } from "@/lib/runtime";
import { NavUser } from "./NavUser";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { BugReportSlideout } from "./BugReportSlideout";



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

export function isParentActive(pathname: string, children: NavigationItem[]): boolean {
  return children.some((child) => isActiveTab(pathname, child.href));
}

interface NavigationItem {
  icon: any;
  label: string;
  href: string;
  children?: NavigationItem[];
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
  navigationItems: NavigationItem[];
  pathname: string;
  handleNavigate: (href: string) => void;
  tasksWaitingForInputCount: number;
  poolCapacityCount: string | null;
  user: SidebarProps['user'];
  isBugReportOpen: boolean;
  setIsBugReportOpen: (open: boolean) => void;
}

const baseNavigationItems: NavigationItem[] = [
  { icon: PiGraphFill, label: "Graph", href: "/" },
  { icon: Server, label: "Capacity", href: "/capacity" },
  {
    icon: Blocks,
    label: "Build",
    href: "/build",
    children: [
      { icon: CheckSquare, label: "Tasks", href: "/tasks" },
      { icon: Map, label: "Plan", href: "/plan" },
      { icon: PenLine, label: "Whiteboards", href: "/whiteboards" },
    ],
  },
  {
    icon: ShieldCheck,
    label: "Protect",
    href: "/protect",
    children: [
      { icon: BarChart3, label: "Recommendations", href: "/recommendations" },
      { icon: TestTube2, label: "Testing", href: "/testing" },
      { icon: Bot, label: "Janitors", href: "/janitors" },
    ],
  },
  {
    icon: Brain,
    label: "Context",
    href: "/context",
    children: [
      { icon: BookOpen, label: "Learn", href: "/learn" },
      { icon: Phone, label: "Calls", href: "/calls" },
      { icon: FileText, label: "Agent Logs", href: "/agent-logs" },
    ],
  },
];

function SidebarContent({
  navigationItems,
  pathname,
  handleNavigate,
  tasksWaitingForInputCount,
  poolCapacityCount,
  user,
  isBugReportOpen,
  setIsBugReportOpen,
}: SidebarContentProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    // Auto-expand Protect if any child route is active
    const initialExpanded = new Set<string>();
    navigationItems.forEach((item) => {
      if (item.children && isParentActive(pathname, item.children)) {
        initialExpanded.add(item.label);
      }
    });
    return initialExpanded;
  });

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Workspace Switcher */}
      <WorkspaceSwitcher onWorkspaceChange={() => null} />
      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navigationItems.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = expandedSections.has(item.label);
            // Parent is only active if directly on parent page, not when child is active
            const isActive = !hasChildren && isActiveTab(pathname, item.href);
            const isTasksItem = item.label === "Tasks";
            const showBadge = isTasksItem && tasksWaitingForInputCount > 0;
            const isCapacityItem = item.label === "Capacity";
            const showCapacityBadge = isCapacityItem && poolCapacityCount;

            return (
              <li key={item.href}>
                <Button
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  variant={isActive ? "secondary" : "ghost"}
                  className={`w-full justify-start ${
                    isActive
                      ? "bg-primary/10 dark:bg-primary/20 hover:bg-primary/20 dark:hover:bg-primary/30"
                      : "hover:bg-primary/5 dark:hover:bg-primary/10"
                  }`}
                  onClick={() => {
                    if (hasChildren) {
                      toggleSection(item.label);
                    } else {
                      handleNavigate(item.href);
                    }
                  }}
                >
                  <item.icon className="w-4 h-4 mr-2" />
                  {item.label}
                  {showBadge && (
                    <Badge className="ml-auto px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-200">
                      {tasksWaitingForInputCount}
                    </Badge>
                  )}
                  {showCapacityBadge && (
                    <Badge className="ml-auto px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 border-blue-200">
                      {poolCapacityCount}
                    </Badge>
                  )}
                  {hasChildren && (
                    <span className="ml-auto">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                  )}
                </Button>
                {/* Render children if expanded */}
                {hasChildren && (
                  <ul className={`relative mt-1 space-y-0 border-l-2 border-muted-foreground/20 ml-[19px] pl-4 ${!isExpanded ? 'hidden' : ''}`}>
                    {item.children!.map((child) => {
                      const isChildActive = isActiveTab(pathname, child.href);
                      const isChildTasksItem = child.label === "Tasks";
                      const showChildBadge = isChildTasksItem && tasksWaitingForInputCount > 0;
                      return (
                        <li key={child.href} className="py-1">
                          <button
                            data-testid={`nav-${child.label.toLowerCase().replace(/\s+/g, '-')}`}
                            className={`w-full text-left text-sm py-1 px-2 rounded-md transition-colors flex items-center ${
                              isChildActive
                                ? "text-foreground font-medium bg-primary/10 dark:bg-primary/20"
                                : "text-foreground hover:bg-primary/5 dark:hover:bg-primary/10"
                            }`}
                            onClick={() => handleNavigate(child.href)}
                          >
                            <span className="flex-1">{child.label}</span>
                            {showChildBadge && (
                              <Badge className="ml-2 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800 border-amber-200">
                                {tasksWaitingForInputCount}
                              </Badge>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Spacer to push bottom content down */}
      <div className="flex-1" />
      {/* Report Bug */}
      <div className="p-4 pb-2">
        <Button
          data-testid="report-bug-button"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => setIsBugReportOpen(true)}
        >
          <Bug className="w-4 h-4 mr-2" />
          Report Bug
        </Button>
      </div>
      {/* Settings */}
      <div className="px-4 pb-2">
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
      {/* Bug Report Slideout */}
      <BugReportSlideout
        open={isBugReportOpen}
        onOpenChange={setIsBugReportOpen}
      />
    </div>
  );
}

export function Sidebar({ user }: SidebarProps) {
  const router = useRouter();
  const { slug: workspaceSlug, workspace, waitingForInputCount, refreshTaskNotifications } = useWorkspace();

  // Use global notification count from WorkspaceContext (not affected by pagination)
  const tasksWaitingForInputCount = waitingForInputCount;

  // Fetch pool status for capacity count with real-time polling (every 10 seconds)
  const isPoolActive = workspace?.poolState === "COMPLETE";
  const { poolStatus } = usePoolStatus(workspaceSlug || "", isPoolActive, { 
    pollingInterval: 10000 // Poll every 10 seconds
  });

  // Calculate pool capacity count (in use / total)
  const poolCapacityCount = useMemo(() => {
    if (!poolStatus) return null;
    const inUse = poolStatus.usedVms || 0;
    const total = poolStatus.runningVms || 0;
    return total > 0 ? `${inUse}/${total}` : null;
  }, [poolStatus]);

  const canAccessDefense = useFeatureFlag(
    FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
  );

  // Create Stak Toolkit items if in stakwork workspace or dev mode
  const devMode = isDevelopmentMode();
  const stakToolkitItems: NavigationItem[] = (workspaceSlug === "stakwork" || devMode) ? [
    {
      icon: Workflow,
      label: "Stak Toolkit",
      href: "/stak-toolkit",
      children: [
        { icon: FileText, label: "Prompts", href: "/prompts" },
        { icon: Workflow, label: "Workflows", href: "/workflows" },
        { icon: Workflow, label: "Projects", href: "/projects" },
      ],
    },
  ] : [];

  const excludeLabels: string[] = [];
  if (!canAccessDefense) excludeLabels.push("Protect");

  // Insert Stak Toolkit items before Build section
  const allNavigationItems = [
    ...baseNavigationItems.slice(0, 2), // Graph and Capacity
    ...stakToolkitItems, // Stak Toolkit (conditionally)
    ...baseNavigationItems.slice(2), // Build, Protect, Context
  ];

  const navigationItems = allNavigationItems.filter(
    (item) => !excludeLabels.includes(item.label),
  );

  const [isOpen, setIsOpen] = useState(false);
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
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
              poolCapacityCount={poolCapacityCount}
              user={user}
              isBugReportOpen={isBugReportOpen}
              setIsBugReportOpen={setIsBugReportOpen}
            />
          </SheetContent>
        </Sheet>
      )}
      {/* Desktop Sidebar */}
      <div
        className={`${isTaskPage ? "hidden" : "hidden md:flex"} ${SIDEBAR_WIDTH} md:flex-col md:fixed md:inset-y-0 md:z-0`}
      >
        <div className="flex flex-col flex-grow bg-sidebar border-sidebar-border border-r">
          <SidebarContent
            navigationItems={navigationItems}
            pathname={pathname}
            handleNavigate={handleNavigate}
            tasksWaitingForInputCount={tasksWaitingForInputCount}
            poolCapacityCount={poolCapacityCount}
            user={user}
            isBugReportOpen={isBugReportOpen}
            setIsBugReportOpen={setIsBugReportOpen}
          />
        </div>
      </div>
    </>
  );
}
