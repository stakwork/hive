"use client";

import React, { useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { StreamErrorBoundary } from "@/components/streaming/StreamErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ActionTip } from "../ActionTip";
import type { ArtifactContentState, ArtifactLoadFailure } from "./useArtifactContent";

/**
 * The pieces the artifact card, panel and viewers share: what stands in
 * for content that is not there, a preview capped in height for the chat
 * card, a scrolling body for the panel, and the panel's toolbar.
 */

// ─── Content that is not there (yet) ────────────────────────────────────

type MissingContent = Exclude<ArtifactContentState, { status: "ready" }>;

const MISSING_TEXT: Record<ArtifactLoadFailure, string> = {
  unavailable: "This artifact is no longer available.",
  denied: "You don't have access to this artifact.",
  failed: "This artifact could not be loaded.",
};

function RetryButton({ state }: { state: MissingContent }) {
  if (state.status !== "failed") return null;
  return (
    <button
      type="button"
      onClick={state.retry}
      className="text-foreground underline underline-offset-4 transition-opacity hover:opacity-80"
    >
      Try again
    </button>
  );
}

/** On the card: content on its way, or a line saying why there is none. Never alarming — it is just absent. */
export function MissingPreview({ state }: { state: MissingContent }) {
  if (state.status === "loading") {
    return (
      <div className="space-y-1.5 px-3 py-3">
        <Skeleton className="h-2.5 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    );
  }
  return (
    <p className="flex flex-wrap gap-x-2 px-3 py-2.5 text-xs text-muted-foreground">
      {MISSING_TEXT[state.status]}
      <RetryButton state={state} />
    </p>
  );
}

/** On the panel: the same, with the panel to itself. */
export function MissingContentPanel({ state }: { state: MissingContent }) {
  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 aria-label="Loading" className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <AlertTriangle aria-hidden className="h-5 w-5" />
      <p>{MISSING_TEXT[state.status]}</p>
      <RetryButton state={state} />
    </div>
  );
}

/**
 * A viewer is handed content another system wrote. It is parsed first, but
 * a viewer that still cannot draw it must not take the chat down with it.
 */
export function ViewerBoundary({ children }: { children: ReactNode }) {
  return (
    <StreamErrorBoundary
      fallback={<p className="px-3 py-2.5 text-xs text-muted-foreground">This artifact could not be shown.</p>}
    >
      {children}
    </StreamErrorBoundary>
  );
}

// ─── Overflow ───────────────────────────────────────────────────────────

const isClipped = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1;
const hasMoreBelow = (el: HTMLElement) => el.scrollTop + el.clientHeight < el.scrollHeight - 2;

/** Re-reads a fact about an element whenever it or its content changes size, and as it scrolls. */
function useMeasured(ref: RefObject<HTMLElement | null>, read: (el: HTMLElement) => boolean): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setValue(read(el));
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref, read]);

  return value;
}

/** A card preview capped in height, fading out at the bottom when its content runs past the cap. */
export function InlineClamp({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const clipped = useMeasured(ref, isClipped);
  return (
    <div className="relative">
      <div ref={ref} className="max-h-[168px] overflow-hidden">
        <div className={className}>{children}</div>
      </div>
      {clipped && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
        />
      )}
    </div>
  );
}

/** A panel body that scrolls, fading out at the bottom while there is more below. */
export function ScrollFade({
  viewportRef,
  className,
  children,
}: {
  /** The scrolling element, for a viewer that places the scroll itself. */
  viewportRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = viewportRef ?? ownRef;
  const more = useMeasured(ref, hasMoreBelow);
  return (
    <div className="relative h-full min-h-0">
      <div ref={ref} className="h-full overflow-auto">
        <div className={className}>{children}</div>
      </div>
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent"
        />
      )}
    </div>
  );
}

/** The strip of a viewer's own controls, under the panel's title bar. */
export function PanelToolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2 text-xs">{children}</div>;
}

export const ICON_BUTTON_CLASS =
  "flex shrink-0 items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

/** An icon button with its tooltip. */
export function ToolbarButton({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  className?: string;
  children: ReactElement;
}) {
  return (
    <ActionTip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(ICON_BUTTON_CLASS, pressed && "bg-muted text-foreground", className)}
      >
        {children}
      </button>
    </ActionTip>
  );
}
