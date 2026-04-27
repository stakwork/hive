"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Calendar, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { useWorkspaceLogos } from "@/hooks/useWorkspaceLogos";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import type { WorkspaceWithRole } from "@/types/workspace";

interface WorkspaceCardProps {
  workspace: WorkspaceWithRole;
  logoUrl: string | undefined;
  canAccessLogo: boolean;
  onDescriptionSaved: (id: string, description: string) => void;
}

function WorkspaceCard({
  workspace,
  logoUrl,
  canAccessLogo,
  onDescriptionSaved,
}: WorkspaceCardProps) {
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
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground overflow-hidden shrink-0">
            {canAccessLogo && logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={workspace.name} className="w-full h-full object-cover" />
            ) : canAccessLogo && workspace.logoKey ? (
              <Skeleton className="w-full h-full rounded-none" />
            ) : (
              <Building2 className="w-5 h-5" />
            )}
          </div>

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
                <p
                  className={`text-sm leading-relaxed flex-1 ${
                    workspace.description
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50 italic"
                  }`}
                >
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

interface WorkspacesViewProps {
  githubLogin: string;
}

export function WorkspacesView({ githubLogin }: WorkspacesViewProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const { logoUrls } = useWorkspaceLogos(workspaces);
  const canAccessLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  useEffect(() => {
    fetch(`/api/orgs/${githubLogin}/workspaces`)
      .then((res) => res.json())
      .then((data) => setWorkspaces(Array.isArray(data) ? data : []))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }, [githubLogin]);

  const onDescriptionSaved = (id: string, description: string) => {
    setWorkspaces((prev) =>
      prev.map((ws) => (ws.id === id ? { ...ws, description } : ws)),
    );
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-12">
        No workspaces found in this organization.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {workspaces.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          workspace={workspace}
          logoUrl={logoUrls[workspace.id]}
          canAccessLogo={canAccessLogo}
          onDescriptionSaved={onDescriptionSaved}
        />
      ))}
    </div>
  );
}
