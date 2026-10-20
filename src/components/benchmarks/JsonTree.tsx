"use client";

import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const isObj = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === "object" && v !== null;

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  if (!isObj(value)) {
    return (
      <div className="font-mono text-xs py-0.5">
        {name !== undefined && <span className="text-muted-foreground">{name}: </span>}
        <span className={typeof value === "string" ? "text-green-600 dark:text-green-400 break-all" : "text-blue-600 dark:text-blue-400"}>
          {typeof value === "string" ? JSON.stringify(value) : String(value)}
        </span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const label = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="group flex items-center gap-1 font-mono text-xs py-0.5 hover:text-foreground">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        {name !== undefined && <span className="text-muted-foreground">{name}</span>}
        <span className="text-muted-foreground">{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-3 border-l pl-2">
        {entries.map(([k, v]) => (
          <Node key={k} name={k} value={v} depth={depth + 1} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A collapsed-by-default JSON tree. */
export function JsonTree({ value, name }: { value: unknown; name?: string }) {
  return <Node name={name} value={value} depth={0} />;
}
