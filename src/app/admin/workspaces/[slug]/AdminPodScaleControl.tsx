"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminPodScaleControlProps {
  slug: string;
  initialMinimumVms: number;
  initialMinimumPods: number | null;
}

export default function AdminPodScaleControl({
  slug,
  initialMinimumVms,
  initialMinimumPods,
}: AdminPodScaleControlProps) {
  const [pendingPods, setPendingPods] = useState(initialMinimumPods ?? 2);
  const [saving, setSaving] = useState(false);

  const hasChanged = pendingPods !== (initialMinimumPods ?? 2);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/w/${slug}/pool/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumPods: pendingPods }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      toast.success("Pod count updated");
    } catch {
      toast.error("Failed to update pod count");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground w-36">Deployed Pods</p>
        <p className="text-sm font-medium">{initialMinimumVms}</p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground w-36">Desired Pod Count</p>
        <Input
          type="number"
          min={1}
          max={20}
          className="w-20"
          value={pendingPods}
          onChange={(e) => setPendingPods(Number(e.target.value))}
        />
      </div>
      <Button
        onClick={handleSave}
        disabled={saving || !hasChanged}
        size="sm"
      >
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
