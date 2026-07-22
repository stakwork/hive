"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialValue: number;
}

export function LegalRecursionConfigPanel({ initialValue }: Props) {
  const [value, setValue] = useState<string>(String(initialValue));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error("Value must be a positive integer (>= 1).");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/legal-recursion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parsed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success("Recursion concurrency cap updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      <div className="w-64 shrink-0">
        <Label className="text-sm font-medium">Max Concurrent Recursion Runs</Label>
        <p className="text-xs text-muted-foreground mt-1">
          Hard cap on simultaneous recursion-flagged eval dispatches per cron pass (default: 3)
        </p>
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
