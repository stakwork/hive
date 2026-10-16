"use client";

import React, { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ActionTip } from "./ActionTip";
import { Switch } from "@/components/ui/switch";
import { getModelValue, type LlmModelOption } from "@/lib/ai/models";
import { AutomationsSection } from "./AutomationsSection";
import { readSlimPromptPreference, writeSlimPromptPreference } from "../_state/slimPromptPreference";

/**
 * The composer's model chip. Shows the user's chosen model ("Default" when
 * they have none) and opens a menu with the model list plus the per-user
 * agent preferences:
 *
 *   - **Model** (`chatAgentModel`) — the per-user default model the canvas
 *     agent chats with, stored in `getModelValue()` "provider/name" form.
 *     "Default" clears it (PATCH null) and inherits the admin-configured
 *     default. Applies to all the user's chats, in every org.
 *
 *   - **Concept-tree prompt** — experimental, per-browser (localStorage,
 *     see `slimPromptPreference.ts`): the canvas agent gets the shorter
 *     capability sections and relies on the concept tree for how-to
 *     detail. Off = the full sections.
 *
 *   - **Automations** — see `AutomationsSection`.
 *
 *   - **Auto-respond to planners** (`canvasAutonomousTurns`) — when on,
 *     the canvas agent may act on its own, without the user prompting
 *     it, when a lower-level agent reports: a planner's message, a
 *     settled strut chat, a job turn's reply (which it summarizes).
 *     Server-side gates live in `src/services/canvas-agent-autoturn.ts`
 *     and `canvas-strut-autoturn.ts`; a global
 *     `CANVAS_AUTONOMOUS_TURNS_ENABLED=false` env var can still
 *     master-kill the feature regardless of this flag.
 *
 * Model and auto-respond are user-level preferences persisted via
 * `/api/user/preferences`, fetched once on mount and saved optimistically
 * with a rollback on failure.
 */
export function ModelChipMenu({ githubLogin }: { githubLogin: string }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [slimPrompt, setSlimPrompt] = useState(false);
  const [models, setModels] = useState<LlmModelOption[]>([]);
  // null = not loaded yet; "" = no choice (Default).
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  // Load the current preference once. Null until loaded so the Switch
  // renders disabled (no flicker between default-off and the real value).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setEnabled(!!data.canvasAutonomousTurns);
          setSelectedModel(data.chatAgentModel ?? "");
        }
      })
      .catch(() => {
        /* leave null; toggle stays disabled until a retry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSlimPrompt(readSlimPromptPreference());
  }, []);

  // Load the available models for the picker. /api/llm-models already
  // filters out providers whose API key isn't configured server-side.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/llm-models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.models) setModels(data.models);
      })
      .catch(() => {
        /* leave empty; picker stays hidden until a retry */
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

  const handleSlimToggle = (next: boolean) => {
    setSlimPrompt(next);
    writeSlimPromptPreference(next);
  };

  const handleModelChange = async (next: string) => {
    if (savingModel || next === selectedModel) return;
    const prev = selectedModel;
    setSelectedModel(next); // optimistic
    setSavingModel(true);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // "Default" clears the user's choice.
        body: JSON.stringify({ chatAgentModel: next || null }),
      });
      if (!res.ok) throw new Error("Request failed");
    } catch {
      setSelectedModel(prev ?? ""); // rollback
      toast.error("Couldn't save that setting", {
        description: "Please try again.",
      });
    } finally {
      setSavingModel(false);
    }
  };

  const current = selectedModel ? models.find((m) => getModelValue(m) === selectedModel) : null;
  const chipLabel = selectedModel ? (current?.name ?? selectedModel) : "Default";

  const itemClass = (selected: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-50",
      selected && "bg-muted/60 font-medium",
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ActionTip label="Model & agent settings" side="top">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Model"
            data-testid="model-chip"
            className="flex max-w-[11rem] items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="truncate">{chipLabel}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        </PopoverTrigger>
      </ActionTip>
      <PopoverContent align="start" side="top" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">Model</p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto" role="listbox" aria-label="Model">
            {[{ value: "", name: "Default" }, ...models.map((m) => ({ value: getModelValue(m), name: m.name }))].map(
              (item) => {
                const selected = (selectedModel ?? "") === item.value;
                return (
                  <button
                    key={item.value || "default"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={selectedModel === null || savingModel}
                    onClick={() => void handleModelChange(item.value)}
                    className={itemClass(selected)}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", !selected && "invisible")} />
                    <span className="truncate">{item.name}</span>
                  </button>
                );
              },
            )}
          </div>
          <p className="text-xs text-muted-foreground">Applies to all your chats, in every org.</p>
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-none">Concept-tree prompt</p>
            <p className="text-xs text-muted-foreground">
              Experimental, this browser only. Use shorter capability sections and rely on the concept tree for detail.
            </p>
          </div>
          <Switch checked={slimPrompt} onCheckedChange={handleSlimToggle} aria-label="Concept-tree prompt" />
        </div>

        <div className="border-t pt-3">
          <AutomationsSection githubLogin={githubLogin} />
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium leading-none">Auto-respond to planners</p>
            <p className="text-xs text-muted-foreground">
              Let the agent act on its own when a planner, a strut chat, or a job reports back — without prompting you.
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
