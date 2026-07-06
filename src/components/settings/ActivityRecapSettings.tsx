"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function ActivityRecapSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/user/preferences")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(!!d.activityRecapEnabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (newValue: boolean) => {
    setSaving(true);
    const previous = enabled;
    setEnabled(newValue);

    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityRecapEnabled: newValue }),
      });

      if (!res.ok) throw new Error("Failed");

      toast.success("Preference saved");
    } catch {
      setEnabled(previous);
      toast.error("Failed to save preference");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Recap</CardTitle>
        <CardDescription>
          When enabled, you will receive an AI-generated recap of your activity
          across your workspaces. Applies across all your workspaces.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch
            id="activity-recap-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={loading || saving}
            aria-label="Enable activity recap"
          />
          <Label htmlFor="activity-recap-toggle" className="cursor-pointer">
            {saving ? "Saving…" : enabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
