"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialHive: number;
  initialGraphmindset: number;
}

interface PriceRowProps {
  label: string;
  type: "hive" | "graphmindset";
  initialValue: number;
}

function PriceRow({ label, type, initialValue }: PriceRowProps) {
  const [value, setValue] = useState<string>(String(initialValue));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const amountUsd = parseFloat(value);
    if (isNaN(amountUsd) || amountUsd <= 0) {
      toast.error("Amount must be a positive number.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/payments-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amountUsd }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success(`${label} price updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Label className="w-48 shrink-0">{label}</Label>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">$</span>
        <Input
          type="number"
          min="0.01"
          step="0.01"
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

export function PaymentsConfigPanel({ initialHive, initialGraphmindset }: Props) {
  return (
    <div className="space-y-4">
      <PriceRow
        label="Hive Environment"
        type="hive"
        initialValue={initialHive}
      />
      <PriceRow
        label="GraphMindset"
        type="graphmindset"
        initialValue={initialGraphmindset}
      />
    </div>
  );
}
