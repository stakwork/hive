"use client";

import React from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileOrgShell } from "./mobile/MobileOrgShell";
import { OrgRail } from "./OrgRail";
import { useOrgView } from "./useOrgView";

interface OrgShellProps {
  githubLogin: string;
  orgId: string;
  orgName: string | null;
  avatarUrl: string | null;
  user: { name: string; email: string; avatar: string };
  children: React.ReactNode;
}

/**
 * Outer chrome for every `/org/[githubLogin]/...` route: the left icon
 * rail, and each view filling the space beside it.
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
  user,
  children,
}: OrgShellProps) {
  const view = useOrgView(githubLogin);
  const isMobile = useIsMobile();
  const displayName = orgName ?? githubLogin;

  // On a phone: one full-screen column and a drawer, not the rail and its panels.
  if (isMobile) {
    return (
      <MobileOrgShell githubLogin={githubLogin} orgName={orgName} avatarUrl={avatarUrl} user={user}>
        {children}
      </MobileOrgShell>
    );
  }

  return (
    // `max-md:invisible`: the server can't tell a phone, so it renders this; hidden until the mobile shell takes over.
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground max-md:invisible">
      <OrgRail githubLogin={githubLogin} activeView={view} org={{ name: displayName, avatarUrl }} user={user} />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
