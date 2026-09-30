"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import {
  latestArtifacts,
  resolveArtifactPanel,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactViewerProps,
  type ResolvedArtifactPanel,
} from "../../_state/canvasChatArtifacts";
import { ActionTip } from "../ActionTip";
import { isTypingTarget } from "../control-panel/ControlPanelList";
import { ICON_BUTTON_CLASS, MissingContentPanel, ToolbarButton, ViewerBoundary } from "./chrome";
import { artifactHref, artifactKind } from "./registry";
import { useArtifactContent } from "./useArtifactContent";
import { useActiveArtifacts, useChatOrgLogin } from "./useArtifactPanel";

/**
 * The artifact panel: the artifact a chat card opened, at full size. The
 * org page gives it the canvas's place, beside the chat it came from
 * (`OrgCanvasView`). One bar — the artifact's name, which doubles as the
 * way to any other artifact in the chat, its versions, and what can be
 * done with it — over the kind's own viewer. Escape closes it.
 */
export function ArtifactPanel() {
  const artifacts = useActiveArtifacts();
  const panel = useCanvasChatStore((s) => s.artifactPanel);

  const resolved = useMemo(() => resolveArtifactPanel(artifacts, panel), [artifacts, panel]);
  // The panel eases out after it is closed; what it showed stays up until it has gone.
  const lastResolved = useRef(resolved);
  if (resolved) lastResolved.current = resolved;
  const shown = resolved ?? lastResolved.current;
  const others = useMemo(() => latestArtifacts(artifacts), [artifacts]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A menu or dialog that was open has already taken the key for itself.
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      useCanvasChatStore.getState().closeArtifactPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return shown ? <OpenArtifact shown={shown} others={others} /> : null;
}

/**
 * The kind's full view. Memoised: the bar above it re-renders as
 * artifacts land in the chat, and a viewer is not cheap to redraw.
 */
const Viewer = React.memo(function Viewer({ artifact, content }: ArtifactViewerProps<ArtifactKind>) {
  const { Panel } = artifactKind(artifact.kind);
  return <Panel artifact={artifact} content={content} />;
});

function OpenArtifact({ shown, others }: { shown: ResolvedArtifactPanel; others: ArtifactRef[] }) {
  const { artifact, versions, index } = shown;
  const spec = artifactKind(artifact.kind);
  const githubLogin = useChatOrgLogin();
  const state = useArtifactContent(artifact);
  const content = state.status === "ready" ? state.content : null;
  const href = content && artifactHref(artifact.kind, content, githubLogin);
  const copyText = useMemo(() => content && spec.copyText?.(content), [spec, content]);
  const { openArtifactPanel, closeArtifactPanel } = useCanvasChatStore.getState();
  // The newest version is followed rather than pinned, so a later revision shows as it lands.
  const showVersion = (next: number) => openArtifactPanel(artifact.id, next === versions.length - 1 ? null : next);

  return (
    <section aria-label={artifact.title} className="flex h-full w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b pl-3 pr-2">
        <spec.Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        {others.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-ml-1 flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-sm font-medium transition-colors hover:bg-muted"
              >
                <span className="truncate">{artifact.title}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              {others.map((other) => {
                const otherSpec = artifactKind(other.kind);
                return (
                  <DropdownMenuItem
                    key={other.id}
                    onSelect={() => openArtifactPanel(other.id)}
                    className={cn(other.id === artifact.id && "bg-muted font-medium")}
                  >
                    <otherSpec.Icon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{other.title}</span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {other.label ?? otherSpec.label}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <h2 className="min-w-0 truncate text-sm font-medium">{artifact.title}</h2>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{artifact.label ?? spec.label}</span>

        {versions.length > 1 && (
          <div className="flex shrink-0 items-center text-xs text-muted-foreground">
            <ToolbarButton
              label="Earlier version"
              onClick={() => showVersion(index - 1)}
              disabled={index === 0}
              className="p-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </ToolbarButton>
            <span className="tabular-nums">
              v{index + 1} of {versions.length}
            </span>
            <ToolbarButton
              label="Later version"
              onClick={() => showVersion(index + 1)}
              disabled={index === versions.length - 1}
              className="p-1"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </ToolbarButton>
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {typeof copyText === "string" && (
            <CopyButton value={copyText} className="rounded p-1.5 hover:bg-muted [&_svg]:h-4 [&_svg]:w-4" />
          )}
          {href && (
            <ActionTip label="Open in new tab">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                className={ICON_BUTTON_CLASS}
              >
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </ActionTip>
          )}
          <ToolbarButton label="Close" onClick={closeArtifactPanel}>
            <X className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {state.status === "ready" ? (
          // Keyed so a viewer's own state — zoom, a filter, where it has browsed to — starts over with each artifact.
          <ViewerBoundary key={`${artifact.id}:${index}`}>
            <Viewer artifact={artifact} content={state.content} />
          </ViewerBoundary>
        ) : (
          <MissingContentPanel state={state} />
        )}
      </div>
    </section>
  );
}
