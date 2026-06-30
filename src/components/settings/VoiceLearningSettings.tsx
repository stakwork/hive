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
import { resetVoiceLearningCache } from "@/hooks/useVoiceLearningPreference";

export function VoiceLearningSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/user/preferences")
      .then((r) => r.json())
      .then((d) => {
        setEnabled(!!d.voiceLearningEnabled);
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
        body: JSON.stringify({ voiceLearningEnabled: newValue }),
      });

      if (!res.ok) throw new Error("Failed");

      resetVoiceLearningCache();
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
        <CardTitle>Voice Correction Learning</CardTitle>
        <CardDescription>
          When enabled, edits you make to voice-dictated text before submitting
          are recorded to help improve transcription accuracy. Only platform
          admins can access this data. Applies across all your workspaces.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <Switch
            id="voice-learning-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={loading || saving}
            aria-label="Enable voice correction learning"
          />
          <Label htmlFor="voice-learning-toggle" className="cursor-pointer">
            {saving ? "Saving…" : enabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
