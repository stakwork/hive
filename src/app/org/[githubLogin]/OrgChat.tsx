"use client";

import { DashboardChat } from "@/components/dashboard/DashboardChat";

const MAX_WORKSPACE_SLUGS = 5;

interface OrgChatProps {
  workspaceSlugs: string[];
  githubLogin: string;
}

export function OrgChat({ workspaceSlugs, githubLogin }: OrgChatProps) {
  const slugs = workspaceSlugs.slice(0, MAX_WORKSPACE_SLUGS);
  return <DashboardChat defaultExtraWorkspaceSlugs={slugs} orgSlug={githubLogin} />;
}
