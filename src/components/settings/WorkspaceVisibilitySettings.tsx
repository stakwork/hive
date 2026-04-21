"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/hooks/useWorkspace";

interface WorkspaceVisibilitySettingsProps {
  isPublicViewable: boolean;
}

export function WorkspaceVisibilitySettings({ isPublicViewable }: WorkspaceVisibilitySettingsProps) {
  const [enabled, setEnabled] = useState(isPublicViewable);
  const [saving, setSaving] = useState(false);
  const { slug, workspace, refreshCurrentWorkspace } = useWorkspace();

  const handleToggle = async (checked: boolean) => {
    if (!slug || !workspace) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: workspace.name,
          slug: workspace.slug,
          description: workspace.description ?? undefined,
          isPublicViewable: checked,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update visibility");
      }

      setEnabled(checked);
      await refreshCurrentWorkspace();
      toast.success(checked ? "Workspace is now publicly viewable" : "Workspace is now private");
    } catch (err) {
      toast.error("Failed to update visibility", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-4 h-4" />
          Public Visibility
        </CardTitle>
        <CardDescription>
          Anyone with the link can browse this workspace without signing in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Label htmlFor="public-viewable" className="flex flex-col gap-1">
            <span className="font-medium">Make this workspace publicly viewable</span>
            <span className="text-sm text-muted-foreground font-normal">
              {enabled
                ? "This workspace is visible to anyone with the link."
                : "Only workspace members can access this workspace."}
            </span>
          </Label>
          <Switch
            id="public-viewable"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving}
            data-testid="public-viewable-toggle"
          />
        </div>
      </CardContent>
    </Card>
  );
}
