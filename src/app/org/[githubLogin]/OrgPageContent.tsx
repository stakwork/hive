"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink } from "lucide-react";
import { WorkspacesPageContent } from "@/components/WorkspacesPageContent";
import { GraphPortal } from "@/components/GraphPortal";
import { OrgChat } from "./OrgChat";
import type { WorkspaceWithRole, OrgMemberResponse } from "@/types/workspace";

const MAX_CHAT_SLUGS = 5;

interface OrgPageContentProps {
  githubLogin: string;
  orgName: string | null;
  avatarUrl: string | null;
}

export function OrgPageContent({ githubLogin, orgName, avatarUrl }: OrgPageContentProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [members, setMembers] = useState<OrgMemberResponse[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [activeTab, setActiveTab] = useState("workspaces");

  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/workspaces`)
      .then((res) => res.json())
      .then((data) => setWorkspaces(Array.isArray(data) ? data : []))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoadingWorkspaces(false));

    fetch(`/api/orgs/${githubLogin}/members`)
      .then((res) => res.json())
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [githubLogin]);

  const displayName = orgName ?? githubLogin;
  const slugs = workspaces.slice(0, MAX_CHAT_SLUGS).map((ws) => ws.slug);
  const hasMoreThanLimit = workspaces.length > MAX_CHAT_SLUGS;

  const isGraph = activeTab === "graph";

  return (
    <div className={`bg-background flex flex-col ${isGraph ? "h-screen" : "min-h-screen"}`}>
      {/* Header + tab triggers always constrained */}
      <div className="max-w-4xl mx-auto px-4 pt-10 w-full">
        {/* Org Header */}
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
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className={isGraph ? "flex flex-col flex-1" : ""}>
        <div className="max-w-4xl mx-auto px-4 w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="graph">Graph</TabsTrigger>
          </TabsList>
        </div>

        {/* Non-graph tabs stay constrained */}
        <div className="max-w-4xl mx-auto px-4 pb-10 w-full">
          {/* Workspaces Tab */}
          <TabsContent value="workspaces">
            {loadingWorkspaces ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : workspaces.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No workspaces found in this organization.
              </p>
            ) : (
              <div className="space-y-3">
                <WorkspacesPageContent workspaces={workspaces} />
              </div>
            )}
          </TabsContent>

          {/* Chat Tab */}
          <TabsContent value="chat">
            {loadingWorkspaces ? (
              <div className="h-40 rounded-lg bg-muted animate-pulse" />
            ) : slugs.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No workspaces available to chat with.
              </p>
            ) : (
              <div className="relative min-h-[60vh]">
                {hasMoreThanLimit && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Showing the first {MAX_CHAT_SLUGS} of {workspaces.length} workspaces (chat limit).
                  </p>
                )}
                <OrgChat workspaceSlugs={slugs} />
              </div>
            )}
          </TabsContent>

          {/* Members Tab */}
          <TabsContent value="members">
            {loadingMembers ? (
              <div className="flex flex-wrap gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
                    <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : members.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No members found in this organization.
              </p>
            ) : (
              <div className="flex flex-wrap gap-6">
                {members.map((member) => {
                  const name = member.name ?? member.githubUsername ?? "Unknown";
                  return (
                    <div key={member.id} className="flex items-center gap-2.5">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={member.image ?? undefined} alt={name} />
                        <AvatarFallback className="text-sm">
                          {name[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </div>

        {/* Graph Tab — full width/height */}
        <TabsContent value="graph" className="flex-1 flex flex-col min-h-0">
          {loadingWorkspaces ? (
            <div className="h-[calc(100vh-200px)] bg-muted animate-pulse" />
          ) : workspaces.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">
              No workspaces available to visualize.
            </p>
          ) : (
            <GraphPortal
              workspaces={workspaces.map((ws) => ({
                id: ws.id,
                name: ws.name,
                slug: ws.slug,
                userRole: ws.userRole,
                memberCount: ws.memberCount,
              }))}
              embedded
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
