"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Calendar, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { WorkspaceWithRole } from "@/types/workspace";
import { useWorkspaceLogos } from "@/hooks/useWorkspaceLogos";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";

interface WorkspacesPageContentProps {
  workspaces: WorkspaceWithRole[];
}

export function WorkspacesPageContent({ workspaces }: WorkspacesPageContentProps) {
  const { logoUrls } = useWorkspaceLogos(workspaces);
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  return (
    <>
      {workspaces.map((workspace) => (
        <Card key={workspace.id} className="group hover:shadow-md transition-all duration-200">
          <Link href={`/w/${workspace.slug}`} className="block">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                {/* Workspace Icon */}
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground overflow-hidden">
                  {canAccessWorkspaceLogo && logoUrls[workspace.id] ? (
                    <img src={logoUrls[workspace.id]} alt={workspace.name} className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-5 h-5" />
                  )}
                </div>

                {/* Workspace Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg group-hover:text-primary transition-colors truncate">
                      {workspace.name}
                    </h3>
                    <Badge
                      variant={workspace.userRole === "OWNER" ? "default" : "secondary"}
                      className="text-xs shrink-0"
                    >
                      {workspace.userRole.toLowerCase()}
                    </Badge>
                  </div>

                  {workspace.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{workspace.description}</p>
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

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </CardContent>
          </Link>
        </Card>
      ))}
    </>
  );
}
