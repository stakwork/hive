"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Calendar, ExternalLink, Link2, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { GraphPortal } from "@/components/GraphPortal";
import { OrgChat } from "./OrgChat";
import { OrgInitiatives } from "./OrgInitiatives";
import { OrgSchematic } from "./OrgSchematic";
import { useWorkspaceLogos } from "@/hooks/useWorkspaceLogos";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import type { WorkspaceWithRole, OrgMemberResponse } from "@/types/workspace";

const MAX_CHAT_SLUGS = 5;

interface OrgPageContentProps {
  githubLogin: string;
  orgName: string | null;
  avatarUrl: string | null;
}

// ─── Workspace card with inline description edit ─────────────────────────────

interface WorkspaceCardProps {
  workspace: WorkspaceWithRole;
  logoUrl: string | undefined;
  canAccessLogo: boolean;
  onDescriptionSaved: (id: string, description: string) => void;
}

function WorkspaceCard({ workspace, logoUrl, canAccessLogo, onDescriptionSaved }: WorkspaceCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraft(workspace.description ?? "");
    setEditing(true);
  };

  const save = async () => {
    const trimmed = draft.trim();
    // Optimistic update
    onDescriptionSaved(workspace.id, trimmed);
    setEditing(false);

    await fetch(`/api/workspaces/${workspace.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: workspace.name,
        slug: workspace.slug,
        description: trimmed,
      }),
    });
  };

  const cancel = () => {
    setEditing(false);
    setDraft(workspace.description ?? "");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      cancel();
    }
  };

  return (
    <Card className="group hover:shadow-md transition-all duration-200">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Workspace Icon */}
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground overflow-hidden shrink-0">
            {canAccessLogo && logoUrl ? (
              <img src={logoUrl} alt={workspace.name} className="w-full h-full object-cover" />
            ) : canAccessLogo && workspace.logoKey ? (
              <Skeleton className="w-full h-full rounded-none" />
            ) : (
              <Building2 className="w-5 h-5" />
            )}
          </div>

          {/* Workspace Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/w/${workspace.slug}`}
                className="font-semibold text-lg hover:text-primary transition-colors truncate"
              >
                {workspace.name}
              </Link>
              <Badge
                variant={workspace.userRole === "OWNER" ? "default" : "secondary"}
                className="text-xs shrink-0"
              >
                {workspace.userRole.toLowerCase()}
              </Badge>
            </div>

            {/* Description inline edit */}
            {editing ? (
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={handleKeyDown}
                placeholder="Add a description…"
                rows={2}
                className="resize-none text-sm mb-2"
                autoFocus
              />
            ) : (
              <div
                className="group/desc flex items-start gap-2 cursor-pointer rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/50 transition-colors mb-2"
                onClick={startEdit}
              >
                <p className={`text-sm leading-relaxed flex-1 ${workspace.description ? "text-muted-foreground" : "text-muted-foreground/50 italic"}`}>
                  {workspace.description || "Add a description…"}
                </p>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover/desc:opacity-100 transition-opacity mt-0.5 shrink-0" />
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                <span>
                  {workspace.memberCount} member{workspace.memberCount !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  Created{" "}
                  {new Date(workspace.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Member card with per-workspace description inline edit ───────────────────

interface MemberCardProps {
  member: OrgMemberResponse;
  githubLogin: string;
  onDescriptionSaved: (userId: string, workspaceId: string, description: string) => void;
}

function MemberCard({ member, githubLogin, onDescriptionSaved }: MemberCardProps) {
  const name = member.name ?? member.githubUsername ?? "Unknown";

  // Determine if there are multiple *different* descriptions
  const nonNullDescs = member.workspaceDescriptions.filter((d) => d.description !== null);
  const uniqueDescriptions = [...new Set(nonNullDescs.map((d) => d.description))];
  const hasMultiple = uniqueDescriptions.length > 1;

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(
    member.workspaceDescriptions[0]?.workspaceId ?? ""
  );
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const activeDesc = member.workspaceDescriptions.find(
    (d) => d.workspaceId === activeWorkspaceId
  );
  const editingDesc = member.workspaceDescriptions.find(
    (d) => d.workspaceId === editingWorkspaceId
  );

  const startEdit = (e: React.MouseEvent, workspaceId: string, currentDesc: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDraft(currentDesc ?? "");
    setEditingWorkspaceId(workspaceId);
  };

  const save = async () => {
    if (!editingWorkspaceId) return;
    const trimmed = draft.trim();
    // Optimistic update
    onDescriptionSaved(member.id, editingWorkspaceId, trimmed);
    setEditingWorkspaceId(null);

    await fetch(`/api/orgs/${githubLogin}/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: editingWorkspaceId, description: trimmed }),
    });
  };

  const cancel = () => {
    setEditingWorkspaceId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      cancel();
    }
  };

  const renderDescriptionEdit = (workspaceId: string, description: string | null) => {
    const isEditing = editingWorkspaceId === workspaceId;

    if (isEditing) {
      return (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          placeholder="Add a description…"
          rows={2}
          className="resize-none text-sm mt-1"
          autoFocus
        />
      );
    }

    return (
      <div
        className="group/desc flex items-start gap-1.5 cursor-pointer rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/50 transition-colors"
        onClick={(e) => startEdit(e, workspaceId, description)}
      >
        <span
          className={`text-xs leading-relaxed flex-1 ${
            description ? "text-muted-foreground" : "text-muted-foreground/50 italic"
          }`}
        >
          {description || "Add a description…"}
        </span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/desc:opacity-100 transition-opacity mt-0.5 shrink-0" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1 min-w-[160px] max-w-[220px]">
      <div className="flex items-center gap-2.5">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={member.image ?? undefined} alt={name} />
          <AvatarFallback className="text-sm">{name[0].toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium truncate">{name}</span>
      </div>

      {hasMultiple ? (
        // Multiple different descriptions — workspace-labelled tab switcher
        <div className="mt-1">
          <div className="flex flex-wrap gap-1 mb-1">
            {member.workspaceDescriptions.map((wd) => (
              <button
                key={wd.workspaceId}
                onClick={() => setActiveWorkspaceId(wd.workspaceId)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  activeWorkspaceId === wd.workspaceId
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground"
                }`}
              >
                {wd.workspaceName}
              </button>
            ))}
          </div>
          {activeDesc && renderDescriptionEdit(activeDesc.workspaceId, activeDesc.description)}
        </div>
      ) : (
        // Single or all-same description — flat display
        member.workspaceDescriptions[0] &&
        renderDescriptionEdit(
          member.workspaceDescriptions[0].workspaceId,
          member.workspaceDescriptions[0].description
        )
      )}
    </div>
  );
}

// ─── Main OrgPageContent ──────────────────────────────────────────────────────

export function OrgPageContent({ githubLogin, orgName, avatarUrl }: OrgPageContentProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [members, setMembers] = useState<OrgMemberResponse[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [activeTab, setActiveTab] = useState("workspaces");

  const { logoUrls } = useWorkspaceLogos(workspaces);
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

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

  const handleWorkspaceDescriptionSaved = (id: string, description: string) => {
    setWorkspaces((prev) =>
      prev.map((ws) => (ws.id === id ? { ...ws, description } : ws))
    );
  };

  const handleMemberDescriptionSaved = (
    userId: string,
    workspaceId: string,
    description: string
  ) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === userId
          ? {
              ...m,
              workspaceDescriptions: m.workspaceDescriptions.map((wd) =>
                wd.workspaceId === workspaceId ? { ...wd, description } : wd
              ),
            }
          : m
      )
    );
  };

  const displayName = orgName ?? githubLogin;
  const slugs = workspaces.slice(0, MAX_CHAT_SLUGS).map((ws) => ws.slug);
  const hasMoreThanLimit = workspaces.length > MAX_CHAT_SLUGS;

  const isExpanded = activeTab === "graph" || activeTab === "schematic";

  return (
    <div className={`bg-background flex flex-col ${isExpanded ? "h-screen" : "min-h-screen"}`}>
      {/* Header */}
      <div className="max-w-4xl mx-auto px-4 pt-10 w-full">
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
      <Tabs value={activeTab} onValueChange={setActiveTab} className={isExpanded ? "flex flex-col flex-1" : ""}>
        <div className="max-w-4xl mx-auto px-4 w-full">
          <div className="flex items-center gap-3 mb-6">
            <TabsList>
              <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="initiatives">Initiatives</TabsTrigger>
              <TabsTrigger value="schematic">Schematic</TabsTrigger>
              <TabsTrigger value="graph">Graph</TabsTrigger>
            </TabsList>
            <Link
              href={`/org/${githubLogin}/connections`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
            >
              <Link2 className="h-3.5 w-3.5" />
              Connections
            </Link>
          </div>
        </div>

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
                {workspaces.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    logoUrl={logoUrls[workspace.id]}
                    canAccessLogo={canAccessWorkspaceLogo}
                    onDescriptionSaved={handleWorkspaceDescriptionSaved}
                  />
                ))}
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
                    Showing the first {MAX_CHAT_SLUGS} of {workspaces.length} workspaces (chat
                    limit).
                  </p>
                )}
                <OrgChat workspaceSlugs={slugs} githubLogin={githubLogin} />
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
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    githubLogin={githubLogin}
                    onDescriptionSaved={handleMemberDescriptionSaved}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Initiatives Tab */}
          <TabsContent value="initiatives">
            <OrgInitiatives githubLogin={githubLogin} />
          </TabsContent>

        </div>

        {/* Schematic Tab — full width/height */}
        <TabsContent value="schematic" className="flex-1 flex flex-col min-h-0">
          <OrgSchematic githubLogin={githubLogin} />
        </TabsContent>

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
