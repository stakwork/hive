"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type PodScalerKey =
  | "queueWaitMinutes"
  | "stalenessWindowDays"
  | "scaleUpBuffer"
  | "maxVmCeiling"
  | "scaleDownCooldownMinutes"
  | "cronEnabled"
  | "podUtilisationThreshold";

interface SettingRowProps {
  label: string;
  description: string;
  settingKey: PodScalerKey;
  initialValue: number;
}

function SettingRow({ label, description, settingKey, initialValue }: SettingRowProps) {
  const [value, setValue] = useState<string>(String(initialValue));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error("Value must be a positive integer.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/pod-scaler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: parsed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success(`${label} updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      <div className="w-64 shrink-0">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="1"
          step="1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-32"
        />
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

interface CronEnabledToggleProps {
  initialValue: number;
}

function CronEnabledToggle({ initialValue }: CronEnabledToggleProps) {
  const [enabled, setEnabled] = useState(initialValue === 1);
  const [saving, setSaving] = useState(false);

  const handleChange = async (checked: boolean) => {
    setEnabled(checked);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/pod-scaler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "cronEnabled", value: checked ? 1 : 0 }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success("Pod Scaler Enabled updated.");
    } catch (err) {
      setEnabled(!checked); // revert on error
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-4 pb-6 border-b">
      <div className="w-64 shrink-0">
        <Label className="text-sm font-medium">Pod Scaler Enabled</Label>
        <p className="text-xs text-muted-foreground mt-1">
          Enable or disable the automated pod scaler cron
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={handleChange} disabled={saving} />
    </div>
  );
}

interface Props {
  initialValues: Record<PodScalerKey, number>;
}

export function PodScalerConfigPanel({ initialValues }: Props) {
  const rows: { key: PodScalerKey; label: string; description: string }[] = [
    {
      key: "queueWaitMinutes",
      label: "Queue Wait Threshold",
      description: "Minutes a task must be queued before counting as over-queued",
    },
    {
      key: "stalenessWindowDays",
      label: "Task Staleness Window",
      description: "Tasks updated more than this many days ago are ignored",
    },
    {
      key: "scaleUpBuffer",
      label: "Scale-Up Buffer",
      description: "Extra VMs added on top of the over-queued task count when scaling up",
    },
    {
      key: "maxVmCeiling",
      label: "Max VM Ceiling",
      description: "Hard maximum number of VMs the scaler will ever set",
    },
    {
      key: "scaleDownCooldownMinutes",
      label: "Scale-Down Cooldown",
      description: "Minutes the scaler must wait after a scale-down before scaling down again",
    },
    {
      key: "podUtilisationThreshold",
      label: "Pod Utilisation Threshold (%)",
      description: "Scale up when this percentage of running pods are in use (0–100)",
    },
  ];

  return (
    <div className="space-y-6">
      <CronEnabledToggle initialValue={initialValues.cronEnabled} />
      {rows.map((row) => (
        <SettingRow
          key={row.key}
          settingKey={row.key}
          label={row.label}
          description={row.description}
          initialValue={initialValues[row.key]}
        />
      ))}
    </div>
  );
}
