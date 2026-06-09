"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { diffSetVarParams } from "@/lib/utils/workflow-params";
import { WorkflowChangesPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/WorkflowChangesPanel";

interface WorkflowVersionDiffProps {
  currentJson: string | null;
  previousJson: string | null;
}

export function WorkflowVersionDiff({ currentJson, previousJson }: WorkflowVersionDiffProps) {
  const [showFullDiff, setShowFullDiff] = useState(false);

  const diff = diffSetVarParams(previousJson, currentJson);
  const hasChanges =
    diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0;

  return (
    <div className="space-y-2 mt-3">
      {!hasChanges ? (
        <p className="text-sm text-muted-foreground">No set_var changes in this version.</p>
      ) : (
        <div className="border rounded-md overflow-hidden text-sm">
          <table className="w-full">
            <tbody>
              {diff.added.map((key) => (
                <tr key={`added-${key}`} className="bg-green-50 dark:bg-green-950">
                  <td className="px-3 py-1.5 font-mono font-medium text-green-700 dark:text-green-400 w-6">+</td>
                  <td className="px-3 py-1.5 font-mono">{key}</td>
                </tr>
              ))}
              {diff.removed.map((key) => (
                <tr key={`removed-${key}`} className="bg-red-50 dark:bg-red-950">
                  <td className="px-3 py-1.5 font-mono font-medium text-red-700 dark:text-red-400 w-6">−</td>
                  <td className="px-3 py-1.5 font-mono">{key}</td>
                </tr>
              ))}
              {diff.modified.map((key) => (
                <tr key={`modified-${key}`} className="bg-amber-50 dark:bg-amber-950">
                  <td className="px-3 py-1.5 font-mono font-medium text-amber-700 dark:text-amber-400 w-6">~</td>
                  <td className="px-3 py-1.5 font-mono">{key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowFullDiff((prev) => !prev)}
        className="text-xs"
      >
        {showFullDiff ? "Hide full JSON diff" : "Show full JSON diff"}
      </Button>

      {showFullDiff && (
        <WorkflowChangesPanel originalJson={previousJson} updatedJson={currentJson} />
      )}
    </div>
  );
}
