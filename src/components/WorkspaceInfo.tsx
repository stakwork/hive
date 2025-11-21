"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Loader2 } from "lucide-react";

/**
 * Example component demonstrating how to use the WorkspaceContext
 * This shows workspace info and provides workspace switching functionality
 */
export function WorkspaceInfo() {
  const { workspace, slug, id, role, workspaces, loading, error, switchWorkspace, refreshWorkspaces, hasAccess } =
    useWorkspace();

  const { canRead, canWrite, canAdmin } = useWorkspaceAccess();

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="ml-2">Loading workspace...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-destructive">Error: {error}</div>
          <Button onClick={refreshWorkspaces} className="mt-2">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!hasAccess || !workspace) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-muted-foreground">No workspace access</div>
        </CardContent>
      </Card>
    );
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "OWNER":
        return "default";
      case "ADMIN":
        return "secondary";
      case "PM":
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <div className="space-y-4">
      {/* Current Workspace Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Current Workspace
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">{workspace.name}</h3>
              <Badge variant={getRoleBadgeVariant(role || "")}>{role}</Badge>
            </div>
            {workspace.description && <p className="text-muted-foreground">{workspace.description}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium">Slug</div>
              <div className="text-sm text-muted-foreground">{slug}</div>
            </div>
            <div>
              <div className="text-sm font-medium">ID</div>
              <div className="text-sm text-muted-foreground font-mono">{id}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <Badge variant={canRead ? "default" : "outline"}>Read: {canRead ? "✓" : "✗"}</Badge>
            <Badge variant={canWrite ? "default" : "outline"}>Write: {canWrite ? "✓" : "✗"}</Badge>
            <Badge variant={canAdmin ? "default" : "outline"}>Admin: {canAdmin ? "✓" : "✗"}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Available Workspaces */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Available Workspaces ({workspaces.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  ws.id === id ? "bg-muted border-primary" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ws.name}</span>
                    <Badge variant={getRoleBadgeVariant(ws.userRole)}>{ws.userRole}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {ws.memberCount} member{ws.memberCount !== 1 ? "s" : ""} • /{ws.slug}
                  </div>
                </div>
                {ws.id !== id && (
                  <Button variant="outline" size="sm" onClick={() => switchWorkspace(ws)}>
                    Switch
                  </Button>
                )}
                {ws.id === id && (
                  <Badge variant="default" className="ml-2">
                    Current
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
