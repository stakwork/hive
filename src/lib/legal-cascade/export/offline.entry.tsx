/**
 * Browser entry for the offline trace export — the ONLY file esbuild is
 * pointed at (scripts/build-cascade-bundle.mjs). It mounts the real
 * CascadeTrace component over the payload the document embeds as
 * `window.__CASCADE_EXPORT__`, with concept peeks served from the embedded
 * map so nothing ever fetches.
 *
 * Keep this file free of app-only imports (Prisma, hooks that need the
 * workspace, Pusher): everything reachable from here ends up in the bundle.
 */

import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CascadeTrace } from "@/components/legal/CascadeTrace";
import type { NodePeek } from "@/components/run-report/NodePeek";
import type { CascadeExportPayload } from "./payload";

declare global {
  interface Window {
    __CASCADE_EXPORT__?: CascadeExportPayload;
  }
}

/** Follow the reader's OS theme — the live app is media-query themed too. */
function followSystemTheme(): void {
  try {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", media.matches);
    apply();
    media.addEventListener?.("change", apply);
  } catch {
    // No matchMedia (very old engine) — stay light.
  }
}

export function OfflineCascadePage({ payload }: { payload: CascadeExportPayload }) {
  const peeks = useMemo(
    () => new Map<string, NodePeek>(Object.entries(payload.peeks ?? {})),
    [payload],
  );
  const skipped = payload.meta.skippedPeeks?.length ?? 0;

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-[1180px] px-4 py-6" data-testid="offline-cascade-page">
        <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h1 className="text-lg font-semibold tracking-tight">Run trace</h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            run {payload.meta.runId}
          </span>
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/70">
            snapshot · exported {payload.meta.exportedAt}
          </span>
        </header>
        <div className="w-full rounded-lg border bg-card">
          <CascadeTrace model={payload.model} workspaceSlug={null} peeks={peeks} />
        </div>
        {skipped > 0 && (
          <p className="mt-3 px-1 font-mono text-[10.5px] text-muted-foreground/70">
            {skipped} concept{skipped === 1 ? "" : "s"} could not be captured in this export;
            those chips open with identity only.
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}

function mount(): void {
  const payload = window.__CASCADE_EXPORT__;
  const root = document.getElementById("cascade-root");
  if (!payload || !root) return;
  followSystemTheme();
  createRoot(root).render(<OfflineCascadePage payload={payload} />);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
}
