"use client";

import React, { useMemo } from "react";
import type { ActionResult } from "@/lib/chat";
import { cn } from "@/lib/utils";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { ScrollFade } from "../chrome";
import { MultiFileDiffView, parseDiffs, type ParsedFile } from "../diff";
import { plural } from "../lines";

/** How many files a card lists before it says how many more there are. */
const INLINE_FILES = 5;

// The two colours `MultiFileDiffView` counts lines in.
const ADDED_CLASS = "text-emerald-600 [.dark_&]:text-emerald-400";
const REMOVED_CLASS = "text-rose-600 [.dark_&]:text-rose-400";

export function diffPatchText(diffs: ActionResult[]): string {
  return diffs.map((diff) => diff.content).join("\n");
}

/** Lines added and removed across a diff's files. */
export function LineCounts({ files }: { files: ParsedFile[] }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <span className="font-mono tabular-nums">
      <span className={ADDED_CLASS}>+{additions}</span> <span className={REMOVED_CLASS}>−{deletions}</span>
    </span>
  );
}

/** The files a diff touches, their line counts in columns. A long path loses its start, not its file name. */
function DiffFileList({ files }: { files: ParsedFile[] }) {
  const shown = files.slice(0, INLINE_FILES);
  const more = files.length - shown.length;
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2.5 gap-y-1 font-mono text-[11px]">
        {shown.map((file, i) => (
          <React.Fragment key={`${file.fileName}-${i}`}>
            <span className="truncate text-left [direction:rtl]" title={file.fileName}>
              <bdi>{file.fileName}</bdi>
            </span>
            <span className={cn("text-right tabular-nums", ADDED_CLASS)}>+{file.additions}</span>
            <span className={cn("text-right tabular-nums", REMOVED_CLASS)}>−{file.deletions}</span>
          </React.Fragment>
        ))}
      </div>
      {more > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">and {plural(more, "more file")}</p>}
    </>
  );
}

export function DiffInline({ content }: ArtifactViewerProps<"diff">) {
  const files = useMemo(() => parseDiffs(content.diffs), [content.diffs]);
  return (
    <div className="px-3 py-2.5">
      <DiffFileList files={files} />
    </div>
  );
}

export function DiffPanel({ content }: ArtifactViewerProps<"diff">) {
  return (
    <ScrollFade className="p-4">
      <MultiFileDiffView diffs={content.diffs} maxHeight="none" />
    </ScrollFade>
  );
}
