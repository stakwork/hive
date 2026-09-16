"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface AdminPodScaleControlProps {
  slug: string;
  initialMinimumVms: number;
  initialMinimumPods: number | null;
  initialKvmEnabled?: boolean;
}

export default function AdminPodScaleControl({
  slug,
  initialMinimumVms,
  initialMinimumPods,
  initialKvmEnabled = false,
}: AdminPodScaleControlProps) {
  const [pendingPods, setPendingPods] = useState(initialMinimumPods ?? 2);
  const [saving, setSaving] = useState(false);
  const [kvmEnabled, setKvmEnabled] = useState(initialKvmEnabled);
  const [kvmSaving, setKvmSaving] = useState(false);
  const [pendingKvmEnabled, setPendingKvmEnabled] = useState<boolean | null>(null);

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

  const handleKvmToggleRequest = (checked: boolean) => {
    if (checked === kvmEnabled || kvmSaving) return;
    setPendingKvmEnabled(checked);
  };

  const handleConfirmKvmToggle = async () => {
    if (pendingKvmEnabled === null) return;
    const nextValue = pendingKvmEnabled;
    setPendingKvmEnabled(null);
    setKvmEnabled(nextValue);
    setKvmSaving(true);
    try {
      const response = await fetch(`/api/w/${slug}/pool/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kvmEnabled: nextValue }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      toast.success(nextValue ? "KVM enabled" : "KVM disabled");
    } catch {
      setKvmEnabled(!nextValue);
      toast.error("Failed to update KVM");
    } finally {
      setKvmSaving(false);
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
      <div className="flex items-center gap-3">
        <Label htmlFor="admin-kvm-enabled" className="text-sm text-muted-foreground w-36">
          KVM
        </Label>
        <Switch
          id="admin-kvm-enabled"
          checked={kvmEnabled}
          onCheckedChange={handleKvmToggleRequest}
          disabled={kvmSaving}
          aria-label="KVM"
          data-testid="admin-kvm-enabled-switch"
        />
        <span className="text-xs text-muted-foreground">
          {kvmSaving ? "Saving…" : kvmEnabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <Button
        onClick={handleSave}
        disabled={saving || !hasChanged}
        size="sm"
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      <ConfirmDialog
        open={pendingKvmEnabled !== null}
        onOpenChange={(open) => {
          if (!open) setPendingKvmEnabled(null);
        }}
        title={pendingKvmEnabled ? "Enable KVM?" : "Disable KVM?"}
        description="Changing KVM is a pool-type switch. Unused pods will be deleted immediately and in-use pods will be flagged for recreation."
        confirmText={pendingKvmEnabled ? "Enable KVM" : "Disable KVM"}
        cancelText="Cancel"
        variant="destructive"
        onConfirm={handleConfirmKvmToggle}
        testId="admin-kvm-confirm-dialog"
      />
    </div>
  );
}
