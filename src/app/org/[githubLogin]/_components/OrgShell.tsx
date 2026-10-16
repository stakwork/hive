"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrgRail } from "./OrgRail";
import { useOrgView, viewIsFullBleed } from "./useOrgView";

interface OrgShellProps {
  githubLogin: string;
  orgId: string;
  orgName: string | null;
  avatarUrl: string | null;
  user: { name: string; email: string; avatar: string };
  children: React.ReactNode;
}

/**
 * Outer chrome for every `/org/[githubLogin]/...` route. Owns the
 * left icon rail and (for non-full-bleed views) the org header.
 *
 * Views: chats, canvas (Map | Initiatives), graph, strut and canvas-demo are
 * full-bleed and render edge-to-edge beside the rail. Settings (workspaces,
 * members, MCP servers) renders inside a centered container under the org
 * header.
 */
export function OrgShell({
  githubLogin,
  orgId: _orgId,
  orgName,
  avatarUrl,
  user,
  children,
}: OrgShellProps) {
  const view = useOrgView(githubLogin);
  const fullBleed = viewIsFullBleed(view);
  const displayName = orgName ?? githubLogin;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <OrgRail
        githubLogin={githubLogin}
        activeView={view}
        user={user}
        org={{ name: orgName ?? githubLogin, avatarUrl }}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {fullBleed ? (
          // Canvas / Connections / Schematic / Graph render their own
          // full-bleed content directly into the remaining space.
          children
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className={cn("mx-auto px-4 pt-10 pb-10 w-full", view === "settings" ? "max-w-5xl" : "max-w-4xl")}>
              <div className="flex items-center gap-4 mb-8">
                <Avatar className="h-14 w-14 rounded-xl">
                  <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
                  <AvatarFallback className="rounded-xl text-lg font-semibold">
                    {displayName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold">{displayName}</h1>
                    <a
                      href={`https://github.com/${githubLogin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={`View ${displayName} on GitHub`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <p className="text-sm text-muted-foreground">@{githubLogin}</p>
                </div>
              </div>

              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
