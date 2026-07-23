"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ConfigSetting {
  key: string;
  value: number;
  label: string;
  description: string;
  defaultValue: number;
}

interface SettingsResponse {
  settings: Array<{ key: string; value: number }>;
}

const CONFIG_META: Record<string, { label: string; description: string; defaultValue: number }> = {
  recursionMaxConcurrent: {
    label: "Max Concurrent Recursion Runs",
    description: "Hard cap on simultaneous recursion-flagged eval dispatches per cron pass (default: 3)",
    defaultValue: 3,
  },
  recursionMaxAttempts: {
    label: "Max Attempts per EvalSet",
    description: "Total attempt cap per EvalSet — recursion is auto-disabled once this many fix attempts have been dispatched, regardless of outcome (default: 10)",
    defaultValue: 10,
  },
  recursionPlateauLimit: {
    label: "Plateau Streak Limit",
    description: "Consecutive non-improving attempts before recursion is auto-disabled for an EvalSet (default: 3). Unscored attempts are transparent — they count toward Max Attempts but don't affect the streak.",
    defaultValue: 3,
  },
};

export function LegalRecursionConfigPanel() {
  const [settings, setSettings] = useState<ConfigSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/settings/legal-recursion");
        if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
        const data: SettingsResponse = await res.json();
        const loaded: ConfigSetting[] = data.settings.map((s) => ({
          key: s.key,
          value: s.value,
          ...(CONFIG_META[s.key] ?? {
            label: s.key,
            description: "",
            defaultValue: s.value,
          }),
        }));
        setSettings(loaded);
        const initial: Record<string, string> = {};
        for (const s of loaded) {
          initial[s.key] = String(s.value);
        }
        setValues(initial);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load recursion settings.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async (key: string) => {
    const raw = values[key];
    const parsed = parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error("Value must be a positive integer (>= 1).");
      return;
    }

    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/settings/legal-recursion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: parsed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
      }

      const updated = await res.json() as { key: string; value: number };
      setSettings((prev) =>
        prev.map((s) => (s.key === key ? { ...s, value: updated.value } : s)),
      );
      toast.success(`${CONFIG_META[key]?.label ?? key} updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading recursion settings…</p>;
  }

  return (
    <div className="space-y-6">
      {settings.map((setting) => (
        <div key={setting.key} className="flex items-start gap-4">
          <div className="w-72 shrink-0">
            <Label className="text-sm font-medium">{setting.label}</Label>
            <p className="text-xs text-muted-foreground mt-1">{setting.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="1"
              step="1"
              value={values[setting.key] ?? String(setting.value)}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [setting.key]: e.target.value }))
              }
              className="w-32"
            />
          </div>
          <Button
            size="sm"
            onClick={() => handleSave(setting.key)}
            disabled={saving[setting.key]}
          >
            {saving[setting.key] ? "Saving…" : "Save"}
          </Button>
        </div>
      ))}
    </div>
  );
}
