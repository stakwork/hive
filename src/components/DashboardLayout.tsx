"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { AlertTriangle, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { GlobalSearch } from "./GlobalSearch";

interface DashboardLayoutProps {
  children: React.ReactNode;
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

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  const { workspace, loading, error } = useWorkspace();
  const pathname = usePathname();
  const isTaskPage = pathname.includes("/task/");

  // Priority 1: Show loading state while workspace is being resolved
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
          <div className="text-lg text-muted-foreground">Loading workspace...</div>
        </div>
      </div>
    );
  }

  // Priority 2: Show error state if workspace loading failed
  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <Card className="max-w-md border-destructive">
          <CardContent className="pt-6 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-sm">Failed to load workspace: {error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Priority 3: Show workspace not found if no workspace after loading completed
  if (!workspace) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <Card className="max-w-md border-destructive">
          <CardContent className="pt-6 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-sm">
              Workspace not found or you don&apos;t have access to this workspace.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <Sidebar user={user} />
      <GlobalSearch />

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isTaskPage ? "md:pl-0" : "md:pl-64"}`}>
        <main className={`flex-1 flex flex-col overflow-auto ${isTaskPage ? "p-1 md:p-3" : "p-4 md:p-6"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
