"use client";

import React, { useState } from "react";
import { ToolValue } from "@/components/streaming/StreamToolCall";
import { toJsonText } from "@/components/streaming/toolCallValue";
import { cn } from "@/lib/utils";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { PanelToolbar, ScrollFade } from "../chrome";
import { plural } from "../lines";
import { treeContentOfJson } from "./ChoiceTree";
import { GraphPanel } from "./graph";

/** "4 fields", "12 items" — what a value holds, when it holds several things. */
export function jsonSummary(value: unknown): string | null {
  if (Array.isArray(value)) return plural(value.length, "item");
  if (value && typeof value === "object") return plural(Object.keys(value).length, "field");
  return null;
}

export function JsonPanel(props: ArtifactViewerProps<"json">) {
  const tree = treeContentOfJson(props.artifact, props.content);
  return tree ? <GraphPanel {...props} content={tree} /> : <JsonValuePanel {...props} />;
}

function JsonValuePanel({ content }: ArtifactViewerProps<"json">) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <span className="pl-2 text-muted-foreground">{jsonSummary(content.value)}</span>
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          aria-pressed={raw}
          className={cn(
            "ml-auto rounded px-2 py-1 transition-colors hover:bg-muted hover:text-foreground",
            raw ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          Raw
        </button>
      </PanelToolbar>
      <div className="min-h-0 flex-1">
        {/* Fields and tables read across; past a page's width a row's cells drift too far apart to follow. */}
        <ScrollFade className={cn("p-4 text-xs", !raw && "max-w-3xl")}>
          {raw ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
              {toJsonText(content.value)}
            </pre>
          ) : (
            <ToolValue value={content.value} />
          )}
        </ScrollFade>
      </div>
    </div>
  );
}
