"use client";

import { DashboardChat } from "@/components/dashboard/DashboardChat";

interface OrgChatProps {
  workspaceSlugs: string[];
  githubLogin: string;
  orgId?: string;
}

export function OrgChat({ workspaceSlugs, githubLogin, orgId }: OrgChatProps) {
  return (
    <DashboardChat
      defaultExtraWorkspaceSlugs={workspaceSlugs}
      orgSlug={githubLogin}
      orgId={orgId}
      maxExtraWorkspaces={Number.POSITIVE_INFINITY}
    />
  );
}
