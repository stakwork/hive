"use client";

/**
 * Automations manager embedded in the canvas Agent gear popover.
 *
 * Lists the user's recurring automations and lets them add a new one with
 * the `+` button: a name, a time of day (interpreted in the browser's
 * timezone), and a prompt. Each automation runs as a fresh org-canvas
 * conversation at the scheduled time (see `src/services/automation-dispatcher.ts`);
 * the canvas auto-opens the most recent unseen run on load.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Clock, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AutomationDTO } from "@/types/automation";

interface AutomationsSectionProps {
  githubLogin: string;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function AutomationsSection({ githubLogin }: AutomationsSectionProps) {
  const [items, setItems] = useState<AutomationDTO[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which automation card is expanded to reveal its prompt (one at a time).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New-automation form fields.
  const [name, setName] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [prompt, setPrompt] = useState("");

  const base = `/api/orgs/${githubLogin}/automations`;

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    }
  }, [base]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const resetForm = () => {
    setName("");
    setTimeOfDay("05:00");
    setPrompt("");
    setCreating(false);
  };

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) {
      toast.error("Name and prompt are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          timeOfDay,
          timezone: browserTimezone(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create");
      }
      const created: AutomationDTO = await res.json();
      setItems((prev) => [created, ...(prev ?? [])]);
      resetForm();
    } catch (err) {
      toast.error("Couldn't create automation", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (a: AutomationDTO, enabled: boolean) => {
    setItems((prev) =>
      (prev ?? []).map((x) => (x.id === a.id ? { ...x, enabled } : x)),
    );
    try {
      const res = await fetch(`${base}/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Request failed");
      const updated: AutomationDTO = await res.json();
      setItems((prev) =>
        (prev ?? []).map((x) => (x.id === a.id ? updated : x)),
      );
    } catch {
      setItems((prev) =>
        (prev ?? []).map((x) =>
          x.id === a.id ? { ...x, enabled: !enabled } : x,
        ),
      );
      toast.error("Couldn't update automation");
    }
  };

  const handleDelete = async (a: AutomationDTO) => {
    const prev = items;
    setItems((cur) => (cur ?? []).filter((x) => x.id !== a.id));
    try {
      const res = await fetch(`${base}/${a.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Request failed");
    } catch {
      setItems(prev ?? []);
      toast.error("Couldn't delete automation");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Automations
        </p>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Add automation"
          aria-label="Add automation"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Existing automations */}
      {items === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 && !creating ? (
        <p className="text-xs text-muted-foreground leading-snug">
          Schedule a prompt to run automatically — e.g. summarize the last 24h
          every morning. It opens as a new chat when you visit.
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((a) => {
            const expanded = expandedId === a.id;
            return (
              <div
                key={a.id}
                className={cn(
                  "rounded-md border bg-card text-sm",
                  !a.enabled && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : a.id)}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                    title={expanded ? "Hide prompt" : "Show prompt"}
                  >
                    <ChevronRight
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block truncate text-[13px] font-medium leading-none">
                        {a.name}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {a.schedule}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Switch
                      checked={a.enabled}
                      onCheckedChange={(v) => handleToggle(a, v)}
                      aria-label="Enable automation"
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Delete automation"
                      aria-label="Delete automation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t px-2.5 py-2">
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Prompt
                    </p>
                    <p className="whitespace-pre-wrap text-[12px] leading-snug text-foreground/80">
                      {a.prompt}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New automation form */}
      {creating && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Morning digest)"
            className="h-8 text-sm"
          />
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">
              Run daily at
            </label>
            <Input
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              className="h-8 w-28 text-sm"
            />
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Prompt to run, e.g. Read recent activity, summarize the past 24 hours, and suggest next steps."
            className="min-h-[72px] text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
