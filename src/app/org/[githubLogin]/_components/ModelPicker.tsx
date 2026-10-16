"use client";

import React, { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { getModelValue, type LlmModelOption } from "@/lib/ai/models";
import { ActionTip } from "./ActionTip";

/**
 * The composer's model picker: a chip showing the user's chosen model
 * ("Default" when they have none) that opens a searchable model list.
 *
 * The choice is the per-user `chatAgentModel` preference, stored in
 * `getModelValue()` "provider/name" form and persisted via
 * `PATCH /api/user/preferences`. "Default" clears it (sends null) and
 * inherits the admin-configured default. It applies to all the user's chats,
 * in every org. Fetched once on mount; saved optimistically with a rollback
 * on failure. The model list comes from `/api/llm-models`, which already
 * filters out providers whose API key isn't configured server-side.
 */
export function ModelPicker() {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<LlmModelOption[]>([]);
  // null = not loaded yet; "" = no choice (Default).
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSelectedModel(data.chatAgentModel ?? "");
      })
      .catch(() => {
        /* leave null; the list stays disabled until a retry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/llm-models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.models) setModels(data.models);
      })
      .catch(() => {
        /* leave empty; only Default is offered until a retry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (next: string) => {
    setOpen(false);
    if (saving || next === (selectedModel ?? "")) return;
    const prev = selectedModel;
    setSelectedModel(next); // optimistic
    setSaving(true);
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
      setSaving(false);
    }
  };

  const current = selectedModel ? models.find((m) => getModelValue(m) === selectedModel) : null;
  const chipLabel = selectedModel ? (current?.name ?? selectedModel) : "Default";
  const items = [{ value: "", name: "Default" }, ...models.map((m) => ({ value: getModelValue(m), name: m.name }))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ActionTip label="Model" side="top">
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
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search models" />
          <CommandList className="max-h-56">
            <CommandEmpty>No models match.</CommandEmpty>
            {items.map((item) => {
              const selected = (selectedModel ?? "") === item.value;
              return (
                <CommandItem
                  key={item.value || "default"}
                  value={`${item.name} ${item.value}`}
                  disabled={selectedModel === null || saving}
                  onSelect={() => void handleSelect(item.value)}
                  className="text-xs"
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", !selected && "invisible")} />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Applies to all your chats, in every org.</p>
      </PopoverContent>
    </Popover>
  );
}
