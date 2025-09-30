"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { AlertTriangle, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

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
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-muted-foreground">Loading workspace...</p>
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
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar user={user} />

      {/* Main content */}
      <div className={`${isTaskPage ? "md:pl-0" : "md:pl-80"}`}>
        <main className={isTaskPage ? "p-1 md:p-3" : "p-4 md:p-8"}>
          {children}
        </main>
        {/* <main className="p-4 md:p-8">{children}</main> */}
      </div>
    </div>
  );
}
