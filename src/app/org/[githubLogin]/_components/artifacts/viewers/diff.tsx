"use client";

import React from "react";
import type { ActionResult } from "@/lib/chat";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { ScrollFade } from "../chrome";
import { MultiFileDiffView } from "../diff";

export function diffPatchText(diffs: ActionResult[]): string {
  return diffs.map((diff) => diff.content).join("\n");
}

export function DiffPanel({ content }: ArtifactViewerProps<"diff">) {
  return (
    <ScrollFade className="p-4">
      <MultiFileDiffView diffs={content.diffs} maxHeight="none" />
    </ScrollFade>
  );
}
