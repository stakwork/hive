"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Boxes, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SystemMapDomainNodesResponse } from "@/types/system-map";

/**
 * The workspace's own System Map components (`SysComponent`, kind not
 * `external`), by name — what a CWE check run can be scoped to.
 */
export function componentNames(body: SystemMapDomainNodesResponse): string[] {
  if (body.status !== "ready") return [];
  const names = body.nodes
    .filter((n) => n.type === "SysComponent" && n.properties.kind !== "external")
    .map((n) => n.name.trim())
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Picks the components a CWE check run covers. None picked means every
 * component (the workflow's default).
 */
export function ComponentPicker({
  slug,
  value,
  onChange,
}: {
  slug: string | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setNames(null);
    setError(null);
    fetch(`/api/workspaces/${slug}/system-map/nodes`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as SystemMapDomainNodesResponse;
        if (body.status === "error") throw new Error(body.error);
        setNames(componentNames(body));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Request failed");
        setNames([]);
      });
    return () => controller.abort();
  }, [slug]);

  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (names ?? []).filter((n) => n.toLowerCase().includes(query));
  }, [names, filter]);

  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name]);

  const label = value.length === 0 ? "All components" : value.length === 1 ? value[0] : `${value.length} components`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-64" data-testid="cwe-component-picker">
          <Boxes className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter components"
          className="mb-2 h-8 text-sm"
        />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {names === null && (
            <p className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the system map…
            </p>
          )}
          {error && <p className="px-1 py-2 text-xs text-muted-foreground">Could not load components: {error}</p>}
          {names !== null && !error && shown.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {names.length === 0 ? "No components in the system map yet." : "Nothing matches."}
            </p>
          )}
          {shown.map((name) => (
            <label
              key={name}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
            >
              <Checkbox checked={value.includes(name)} onCheckedChange={() => toggle(name)} />
              <span className="truncate">{name}</span>
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 h-7 w-full text-xs" onClick={() => onChange([])}>
            Clear — check all components
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
