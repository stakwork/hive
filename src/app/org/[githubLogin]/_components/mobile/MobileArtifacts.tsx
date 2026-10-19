"use client";

import React from "react";
import { useMemo } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { artifactIdentity, latestArtifacts } from "../../_state/canvasChatArtifacts";
import { ArtifactPanel, groupIndex } from "../artifacts/ArtifactPanel";
import { artifactAsks, artifactKind } from "../artifacts/registry";
import { useActiveArtifacts, useArtifactJobs, useArtifactPanelOpen } from "../artifacts/useArtifactPanel";
import { TOP_BAR_BUTTON } from "./MobileTopBar";

/** The artifacts button of the chat's top bar; the badge counts what waits on the reader. */
export function MobileArtifactsButton() {
  const artifacts = useActiveArtifacts();
  const { total, waiting } = useMemo(() => {
    const latest = latestArtifacts(artifacts);
    return { total: latest.length, waiting: latest.filter(artifactAsks).length };
  }, [artifacts]);
  // As on desktop (`ArtifactsToggle`): nothing to open, no button.
  if (total === 0) return null;
  return (
    <button
      type="button"
      data-testid="mobile-artifacts-button"
      aria-label={waiting > 0 ? `Artifacts, ${waiting} waiting on you` : "Artifacts"}
      onClick={() => useCanvasChatStore.getState().openArtifactIndex()}
      className={cn(TOP_BAR_BUTTON, "relative")}
    >
      <Layers className="h-5 w-5" />
      {waiting > 0 && (
        <span
          data-testid="mobile-artifacts-badge"
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground"
        >
          {waiting}
        </span>
      )}
    </button>
  );
}

/**
 * The two ways an artifact shows on a phone: the index as a bottom sheet, and
 * one artifact as a full-screen sheet — both driven by the store's artifact
 * panel, the state the desktop's third pane is driven by.
 */
export function MobileArtifactLayer() {
  const open = useArtifactPanelOpen();
  const identity = useCanvasChatStore((s) => s.artifactPanel?.identity ?? null);
  return (
    <>
      <MobileArtifactIndex open={open && identity === null} />
      <MobileArtifactSheet open={open && identity !== null} />
    </>
  );
}

function MobileArtifactIndex({ open }: { open: boolean }) {
  const artifacts = useActiveArtifacts();
  const jobs = useArtifactJobs();
  const latest = useMemo(() => latestArtifacts(artifacts), [artifacts]);
  const groups = useMemo(() => groupIndex([...latest].reverse(), jobs), [latest, jobs]);
  const { openArtifactPanel, closeArtifactPanel } = useCanvasChatStore.getState();
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeArtifactPanel()}>
      <SheetContent
        side="bottom"
        data-testid="mobile-artifact-index"
        className="max-h-[80dvh] gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="pb-2">
          <SheetTitle>
            Artifacts <span className="text-sm font-normal tabular-nums text-muted-foreground">{latest.length}</span>
          </SheetTitle>
          <SheetDescription className="sr-only">Everything Jamie made in this chat</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label} className="pb-2">
              <h3
                className={cn(
                  "flex items-center gap-1.5 px-3 pb-1 pt-2 text-xs font-medium",
                  group.key === "waiting" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                )}
              >
                <span className="truncate">{group.label}</span>
                <span className="tabular-nums opacity-70">{group.artifacts.length}</span>
              </h3>
              <ul>
                {group.artifacts.map((artifact) => {
                  const spec = artifactKind(artifact.kind);
                  const id = artifactIdentity(artifact);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => openArtifactPanel(id)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left active:bg-muted"
                      >
                        <spec.Icon aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base">{artifact.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {artifact.label ?? spec.label}
                            {artifact.summary && ` · ${artifact.summary}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One artifact, full screen. The grab bar at the top drags it down to close. */
function MobileArtifactSheet({ open }: { open: boolean }) {
  const controls = useDragControls();
  const close = () => useCanvasChatStore.getState().closeArtifactPanel();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="artifact-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Artifact"
          data-testid="mobile-artifact-sheet"
          className="fixed inset-0 z-40 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
          drag="y"
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ top: 0 }}
          dragElastic={0}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 600) close();
          }}
        >
          <div
            data-testid="mobile-artifact-grabber"
            onPointerDown={(e) => controls.start(e)}
            className="relative flex h-11 shrink-0 touch-none items-center justify-center"
          >
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            <button
              type="button"
              aria-label="Close artifact"
              data-testid="mobile-artifact-close"
              onClick={close}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(TOP_BAR_BUTTON, "absolute left-1 top-0")}
            >
              <ChevronDown className="h-6 w-6" />
            </button>
          </div>
          {/* The grabber row owns Close; the panel's own X would be a second one. */}
          <div className="min-h-0 flex-1 [&_button[aria-label='Close']]:hidden">
            <ArtifactPanel />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
