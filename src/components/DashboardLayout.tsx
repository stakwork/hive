"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNotificationFavicon } from "@/hooks/useNotificationFavicon";
import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { GlobalSearch } from "./GlobalSearch";
import { ViewerAccessBanner } from "./workspace/ViewerAccessBanner";
import { PublicWorkspaceBanner } from "./workspace/PublicWorkspaceBanner";
import { useEffect, useState } from "react";

/**
 * Sub-paths under `/w/[slug]/` that are off-limits to public (unauthenticated)
 * viewers even when the workspace is `isPublicViewable`. These pages either
 * expose infra details, security findings, or are pure write surfaces.
 *
 * Matched as path segments — i.e. `/w/foo/agent-logs` and
 * `/w/foo/agent-logs/abc` both match "agent-logs". Keep entries slash-free.
 */
const PUBLIC_VIEWER_BLOCKED_SEGMENTS = [
  "agent-logs",       // raw agent conversations; likely leaks PII / secrets
  "capacity",         // pool / pod infra
  "janitors",         // janitor config
  "recommendations",  // security findings (incl. GitLeaks)
  "workflows",        // stakwork write surface
  "projects",         // stakwork write surface
  "settings",         // already server-gated, but belt-and-suspenders
  "graph-admin",      // already server-gated
] as const;

function isBlockedForPublicViewer(pathname: string): boolean {
  const match = pathname.match(/^\/w\/[^/]+\/([^/?#]+)/);
  if (!match) return false;
  return (PUBLIC_VIEWER_BLOCKED_SEGMENTS as readonly string[]).includes(match[1]);
}

// Also block the explicit "new" sub-routes that are pure write surfaces.
function isBlockedWritePath(pathname: string): boolean {
  return (
    /^\/w\/[^/]+\/plan\/new(\/|$)/.test(pathname) ||
    /^\/w\/[^/]+\/task\/new(\/|$)/.test(pathname)
  );
}

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
  } | null;
  isPublicWorkspace?: boolean;
}

export function DashboardLayout({ children, user, isPublicWorkspace = false }: DashboardLayoutProps) {
  const { workspace, loading, error, isPublicViewer } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const isFullscreenPage = pathname.includes("/task/") || pathname.includes("/plan/");
  const [workspaceLogoUrl, setWorkspaceLogoUrl] = useState<string | null>(null);

  // Redirect public viewers away from sensitive or write-only pages.
  // `isPublicWorkspace` is a hint from the server-rendered layout; the
  // client-side `isPublicViewer` is the real source of truth because it
  // reflects the loaded session + workspace, not just the initial request.
  const pageBlockedForPublic =
    (isPublicViewer || isPublicWorkspace) &&
    (isBlockedForPublicViewer(pathname) || isBlockedWritePath(pathname));

  useEffect(() => {
    if (pageBlockedForPublic && workspace?.slug) {
      router.replace(`/w/${workspace.slug}`);
    }
  }, [pageBlockedForPublic, workspace?.slug, router]);

  // Fetch workspace logo URL when workspace changes
  useEffect(() => {
    const fetchWorkspaceLogo = async () => {
      if (!workspace?.slug || !workspace?.logoKey) {
        setWorkspaceLogoUrl(null);
        return;
      }

      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/image`);
        if (response.ok) {
          const data = await response.json();
          setWorkspaceLogoUrl(data.presignedUrl || null);
        } else {
          setWorkspaceLogoUrl(null);
        }
      } catch (error) {
        console.error('Error fetching workspace logo for favicon:', error);
        setWorkspaceLogoUrl(null);
      }
    };

    fetchWorkspaceLogo();
  }, [workspace?.slug, workspace?.logoKey]);

  // Update favicon with notification dot when tasks await input
  useNotificationFavicon({ workspaceLogoUrl, enabled: true });

  // Priority 0: Intercept blocked pages for public viewers before rendering
  // children, so no auth-only fetches get kicked off while the redirect is
  // in flight.
  if (pageBlockedForPublic) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="w-full h-full flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
          <div className="text-lg text-muted-foreground">Redirecting…</div>
        </div>
      </div>
    );
  }

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
      <Sidebar user={user ?? {}} />
      <GlobalSearch />

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isFullscreenPage ? "md:pl-0" : "md:pl-64"}`}>
        <ViewerAccessBanner />
        <PublicWorkspaceBanner />
        <main className={`flex-1 flex flex-col overflow-auto ${isFullscreenPage ? "p-1 md:p-3" : "p-4 md:p-6"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
