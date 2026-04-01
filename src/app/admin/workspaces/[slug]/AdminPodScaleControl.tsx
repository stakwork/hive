"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminPodScaleControlProps {
  slug: string;
  initialMinimumVms: number;
}

export default function AdminPodScaleControl({
  slug,
  initialMinimumVms,
}: AdminPodScaleControlProps) {
  const [pendingVms, setPendingVms] = useState(initialMinimumVms);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/w/${slug}/pool/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumVms: pendingVms }),
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
    <div className="flex items-center gap-3">
      <p className="text-sm text-muted-foreground w-32">Minimum Pods</p>
      <Input
        type="number"
        min={1}
        className="w-20"
        value={pendingVms}
        onChange={(e) => setPendingVms(Number(e.target.value))}
      />
      <Button
        onClick={handleSave}
        disabled={saving || pendingVms === initialMinimumVms}
        size="sm"
      >
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
