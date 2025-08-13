// src/components/WorkspaceSettingsForm.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { FormField } from "@/components/onboarding/FormField";

type Props = {
  currentSlug: string;
  initialName: string;
  initialSlug: string;
  initialDescription?: string | null;
};

export default function WorkspaceSettingsForm({
  currentSlug,
  initialName,
  initialSlug,
  initialDescription,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = React.useState(initialName);
  const [slug, setSlug] = React.useState(initialSlug);
  const [description, setDescription] = React.useState(initialDescription ?? "");
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [apiError, setApiError] = React.useState<string | null>(null);

  const hasChanges = () => {
    return (
      name.trim() !== initialName ||
      slug.trim() !== initialSlug ||
      description.trim() !== (initialDescription ?? "")
    );
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Workspace name is required";
    if (!slug.trim()) e.slug = "Slug is required";
    else if (slug.trim().length < 3) e.slug = "Slug must be at least 3 characters";
    else if (!/^[a-z0-9-]+$/.test(slug.trim()))
      e.slug = "Slug can only contain lowercase letters, numbers, and hyphens";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setApiError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(currentSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          slug: slug.trim().toLowerCase(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update workspace");
      }

      const updated = data.workspace as {
        slug: string;
        name: string;
        description?: string | null;
      };

      toast({ title: "Workspace updated" });

      if (updated.slug !== currentSlug) {
        router.replace(`/w/${updated.slug}/settings`);
      } else {
        // refresh current page data
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setApiError(msg);
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6 pt-6">
          <FormField
            id="ws-name"
            label="Workspace name"
            placeholder="e.g., Product Team"
            value={name}
            onChange={(v) => {
              setName(v);
              if (!initialName && !slug) {
                setSlug(
                  v
                    .toLowerCase()
                    .replace(/[^a-z0-9\s-]/g, "")
                    .replace(/\s+/g, "-")
                    .replace(/-+/g, "-")
                    .trim(),
                );
              }
            }}
            error={errors.name}
            disabled={loading}
          />

          <FormField
            id="ws-slug"
            label="Workspace URL"
            placeholder="my-workspace"
            value={slug}
            onChange={(v) => setSlug(v.toLowerCase())}
            error={errors.slug}
            disabled={loading}
            prefix="hive.app/"
          />

          <FormField
            id="ws-description"
            label="Description (optional)"
            type="textarea"
            placeholder="Describe your workspace..."
            value={description}
            onChange={setDescription}
            disabled={loading}
            rows={3}
          />

          {apiError && (
            <div className="p-3 border border-destructive bg-destructive/10 rounded-md">
              <p className="text-sm text-destructive">{apiError}</p>
            </div>
          )}

          <Button type="submit" disabled={!hasChanges() || loading}>
            {loading ? "Saving..." : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}