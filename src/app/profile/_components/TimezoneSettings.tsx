"use client";

import { useState, useEffect } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { resetTimezoneCache } from "@/hooks/useUserTimezone";

const TIMEZONES: string[] = Intl.supportedValuesOf("timeZone");

export function TimezoneSettings() {
  const [open, setOpen] = useState(false);
  const [timezone, setTimezone] = useState<string>("UTC");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/user/preferences")
      .then((r) => r.json())
      .then((d: { timezone?: string }) => {
        if (d.timezone) setTimezone(d.timezone);
      })
      .catch(() => {});
  }, []);

  async function handleSelect(value: string) {
    setOpen(false);
    setSaving(true);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setTimezone(value);
      resetTimezoneCache();
      toast.success("Timezone updated");
    } catch {
      toast.error("Failed to update timezone");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold mb-1">Display Timezone</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Timestamps across Hive will be shown in your chosen timezone.
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={saving}
            className="w-full max-w-sm justify-between"
          >
            <span className="truncate">{timezone}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-sm p-0" align="start">
          <Command>
            <CommandInput placeholder="Search timezone..." />
            <CommandList className="max-h-64">
              <CommandEmpty>No timezone found.</CommandEmpty>
              <CommandGroup>
                {TIMEZONES.map((tz) => (
                  <CommandItem key={tz} value={tz} onSelect={handleSelect}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        timezone === tz ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {tz}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
