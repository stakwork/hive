"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { resetVoiceLearningCache } from "@/hooks/useVoiceLearningPreference";

export function VoiceLearningSettings() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/user/preferences")
      .then((r) => r.json())
      .then((d: { voiceLearningEnabled?: boolean }) => {
        setEnabled(!!d.voiceLearningEnabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(newValue: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceLearningEnabled: newValue }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEnabled(newValue);
      resetVoiceLearningCache();
      toast.success(newValue ? "Voice correction learning enabled" : "Voice correction learning disabled");
    } catch {
      toast.error("Failed to update preference");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 mt-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1">Voice Correction Learning</h2>
          <p className="text-xs text-muted-foreground">
            When enabled, edits you make to voice-dictated text before submitting are recorded to
            help improve transcription accuracy. Only you and platform admins can see this data.
            Applies across all workspaces.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={loading || saving}
          aria-label="Enable voice correction learning"
        />
      </div>
    </div>
  );
}
