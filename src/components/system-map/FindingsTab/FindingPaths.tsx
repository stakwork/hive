import React from "react";
import type { SystemMapFindingPathStep } from "@/types/system-map";

export function pathStepLabel(step: SystemMapFindingPathStep): string {
  return step.version && !step.name.includes("@") ? `${step.name}@${step.version}` : step.name;
}

/** A vulnerable package's way into the system: component → direct package → … → the package. */
export function FindingPaths({ paths }: { paths: SystemMapFindingPathStep[][] }) {
  return (
    <ol className="space-y-1" data-testid="finding-paths">
      {paths.map((path) => (
        <li
          key={path.map((step) => step.refId).join(">")}
          className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs"
          data-testid="finding-path"
        >
          {path.map((step, i) => (
            <React.Fragment key={step.refId}>
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <span
                className={
                  i === path.length - 1
                    ? "font-mono text-[11px] text-red-600 dark:text-red-400"
                    : step.nodeType === "SysComponent"
                      ? "font-medium"
                      : "font-mono text-[11px]"
                }
                title={step.nodeType}
              >
                {pathStepLabel(step)}
              </span>
            </React.Fragment>
          ))}
        </li>
      ))}
    </ol>
  );
}
