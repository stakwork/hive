"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ExternalLink } from "lucide-react";
import { OrgRail } from "./OrgRail";
import { useOrgView, viewIsFullBleed } from "./useOrgView";

interface OrgShellProps {
  githubLogin: string;
  orgId: string;
  orgName: string | null;
  avatarUrl: string | null;
  children: React.ReactNode;
}

/**
 * Outer chrome for every `/org/[githubLogin]/...` route. Owns the
 * left icon rail and (for non-full-bleed views) the org header.
 *
 * Full-bleed views (canvas, connections, schematic, graph) skip the
 * header and render their own content edge-to-edge alongside the
 * rail. Other views (initiatives, workspaces, members, chat) render
 * inside a centered max-w container with the org header at the top.
 */
export function OrgShell({
  githubLogin,
  // orgId / avatarUrl threaded through `OrgShellContext` if/when child
  // routes need them; current children re-fetch what they need so we
  // don't pre-pass them. Kept on the props for forward compatibility
  // and so the layout's server component has a single place to wire
  // server-loaded org data into the client tree.
  orgId: _orgId,
  orgName,
  avatarUrl,
  children,
}: OrgShellProps) {
  const view = useOrgView(githubLogin);
  const fullBleed = viewIsFullBleed(view);
  const displayName = orgName ?? githubLogin;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <OrgRail githubLogin={githubLogin} activeView={view} />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {fullBleed ? (
          // Canvas / Connections / Schematic / Graph render their own
          // full-bleed content directly into the remaining space.
          children
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto px-4 pt-10 pb-10 w-full">
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
