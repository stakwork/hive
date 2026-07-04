"use client";

import React from "react";
import { DiffView } from "./changes/DiffView";

interface WorkflowChangesPanelProps {
  originalJson: string | null;
  updatedJson: string | null;
}

/**
 * Renders a diff between two workflow JSON strings.
 * Delegates all rendering logic to the shared `DiffView` component.
 */
export function WorkflowChangesPanel({ originalJson, updatedJson }: WorkflowChangesPanelProps) {
  return (
    <DiffView original={originalJson} updated={updatedJson} label="workflow" />
  );
}
