"use client";

import React, { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

/**
 * Gear menu on the canvas Agent chat panel. Hosts per-user preferences
 * for how the agent behaves. Currently a single toggle:
 *
 *   - **Auto-respond to planners** (`canvasAutonomousTurns`) — when on,
 *     the canvas agent may reply to lower-level planner agents on its
 *     own, without the user prompting it. Server-side gate lives in
 *     `src/services/canvas-agent-autoturn.ts`; a global
 *     `CANVAS_AUTONOMOUS_TURNS_ENABLED=false` env var can still
 *     master-kill the feature regardless of this flag.
 *
 * The value is a user-level preference (not per-conversation), persisted
 * via `/api/user/preferences`. Fetched once on mount; toggled
 * optimistically with a rollback on failure.
 */
export function CanvasAgentSettingsPopover() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the current preference once. Null until loaded so the Switch
  // renders disabled (no flicker between default-off and the real value).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setEnabled(!!data.canvasAutonomousTurns);
      })
      .catch(() => {
        /* leave null; toggle stays disabled until a retry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (next: boolean) => {
    const prev = enabled;
    setEnabled(next); // optimistic
    setSaving(true);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasAutonomousTurns: next }),
      });
      if (!res.ok) throw new Error("Request failed");
    } catch {
      setEnabled(prev ?? false); // rollback
      toast.error("Couldn't save that setting", {
        description: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Agent settings"
          className="p-1.5 rounded hover:bg-muted transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-none">
              Auto-respond to planners
            </p>
            <p className="text-xs text-muted-foreground">
              Let the agent reply to lower-level planner agents on its own,
              without prompting you.
            </p>
          </div>
          <Switch
            checked={enabled ?? false}
            onCheckedChange={handleToggle}
            disabled={enabled === null || saving}
            aria-label="Auto-respond to planners"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
