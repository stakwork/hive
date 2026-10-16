"use client";

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
  const displayName = orgName ?? githubLogin;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <OrgRail githubLogin={githubLogin} activeView={view} org={{ name: displayName, avatarUrl }} user={user} />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
