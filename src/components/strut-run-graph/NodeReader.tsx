"use client";

import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SafeMarkdown } from "@/components/run-report/SafeMarkdown";
import { nodeText } from "@/lib/strut-run-graph/node-text";
import { parseQualifiedRef } from "@/lib/strut-run-graph/peer-ref";
import type { RunGraphNode, RunGraphNodeBody } from "@/lib/strut-run-graph/types";

/** A property that is not prose, as one line. */
function attribute(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * A node, open to read: its text as markdown, then its other properties.
 * The text is the graph's, written by agents and ingests, so it renders
 * escaped — `SafeMarkdown`, never an HTML sink.
 */
export function RunGraphNodeReader({
  node,
  body,
  color,
  open,
  onOpenChange,
}: {
  node: RunGraphNode;
  body: RunGraphNodeBody;
  color: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const text = useMemo(() => nodeText(body.properties), [body]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="run-graph-node-reader">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="min-w-0 break-words">{node.name}</span>
            <Badge variant="outline" className="shrink-0 font-normal">
              {node.node_type}
            </Badge>
            {node.peer && (
              <Badge variant="outline" className="shrink-0 font-normal">
                @{node.peer}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {parseQualifiedRef(node.ref_id).refId}
          </DialogDescription>
        </DialogHeader>
        {text.prose.map(([key, markdown]) => (
          <section key={key} data-testid="run-graph-node-prose">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{key}</p>
            <SafeMarkdown text={markdown} className="text-sm leading-relaxed text-foreground" />
          </section>
        ))}
        {text.prose.length === 0 && (
          <p className="text-sm italic text-muted-foreground">The graph stores no text on this node.</p>
        )}
        {text.rest.length > 0 && (
          <dl
            className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-3 text-xs"
            data-testid="run-graph-node-attributes"
          >
            {text.rest.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt className="truncate font-mono text-muted-foreground">{key}</dt>
                <dd className="break-words">{attribute(value)}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
