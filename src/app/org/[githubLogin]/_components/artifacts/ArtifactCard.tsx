"use client";

import React, { useMemo, useRef } from "react";
import { useInView } from "framer-motion";
import { ArrowUpRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import {
  artifactIdentity,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactViewerProps,
} from "../../_state/canvasChatArtifacts";
import { ActionTip } from "../ActionTip";
import { ICON_BUTTON_CLASS, MissingPreview, ViewerBoundary } from "./chrome";
import { artifactHref, artifactKind } from "./registry";
import { useArtifactContent, type ArtifactContentState } from "./useArtifactContent";
import { useChatOrgLogin } from "./useArtifactPanel";

interface ArtifactCardProps {
  artifact: ArtifactRef;
  /** This card's place among the versions of its artifact, zero-based — the last, since the card is the newest ref. */
  version: number;
  versionCount: number;
}

/**
 * The kind's preview. Memoised: the card around it re-renders as the
 * panel opens and closes, and a preview is not cheap to redraw.
 */
const Preview = React.memo(function Preview({ artifact, content }: ArtifactViewerProps<ArtifactKind>) {
  const { Inline } = artifactKind(artifact.kind);
  if (!Inline) return null;
  return (
    <ViewerBoundary>
      <Inline artifact={artifact} content={content} />
    </ViewerBoundary>
  );
});

/** What sits under the card's heading: the preview, what stands in for it, or nothing. */
function CardBody({
  artifact,
  state,
  onOpen,
}: {
  artifact: ArtifactRef;
  state: ArtifactContentState;
  onOpen: () => void;
}) {
  const { Inline, inlineInteractive } = artifactKind(artifact.kind);

  if (state.status !== "ready") {
    // A kind with no preview has nothing to wait for; content that went missing says so either way.
    if (!Inline && state.status === "loading") return null;
    return (
      <div className="border-t">
        <MissingPreview state={state} />
      </div>
    );
  }
  if (!Inline) return null;

  const preview = <Preview artifact={artifact} content={state.content} />;
  if (inlineInteractive) return <div className="border-t">{preview}</div>;
  // A picture of the artifact, not the artifact: anywhere on it opens the real thing.
  return (
    <div className="cursor-pointer border-t" onClick={onOpen}>
      <div className="pointer-events-none select-none">{preview}</div>
    </div>
  );
}

/**
 * An artifact in the chat: what it is, a preview of it, and the way onto
 * the artifact panel. The ref alone is enough to name it; its content is
 * read once the card has been on screen, and the preview follows. One card
 * per artifact, under the message that reported it last
 * (`indexArtifactCards`): a plan revised turn after turn shows once, where
 * it was last revised, and the panel steps back through its versions where
 * there are any.
 */
export const ArtifactCard = React.memo(function ArtifactCard({ artifact, version, versionCount }: ArtifactCardProps) {
  const spec = artifactKind(artifact.kind);
  const githubLogin = useChatOrgLogin();
  const cardRef = useRef<HTMLDivElement>(null);
  const seen = useInView(cardRef, { once: true });
  const state = useArtifactContent(artifact, seen);
  const identity = artifactIdentity(artifact);
  const onPanel = useCanvasChatStore((s) => s.artifactPanel?.identity === identity);

  // The card is the artifact's newest ref, so the panel opens following the newest version.
  const open = () => useCanvasChatStore.getState().openArtifactPanel(identity);
  const close = () => useCanvasChatStore.getState().closeArtifactPanel();

  const content = state.status === "ready" ? state.content : null;
  const href = content && artifactHref(artifact.kind, content, githubLogin);
  const fact = useMemo(() => content && spec.fact?.(content), [spec, content]);
  const PanelIcon = onPanel ? PanelLeftClose : PanelLeftOpen;
  const panelAction = onPanel ? "Close panel" : "Open in panel";

  return (
    <div
      ref={cardRef}
      data-artifact-id={artifact.id}
      className={cn(
        "w-full max-w-[560px] overflow-hidden rounded-lg border bg-card text-card-foreground transition-colors",
        onPanel && "border-foreground/30",
      )}
    >
      <div className="flex cursor-pointer items-start gap-2 py-2.5 pl-3 pr-2" onClick={open}>
        <spec.Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-[10px] tracking-wide text-muted-foreground">
            <span className="shrink-0 font-medium uppercase">{artifact.label ?? spec.label}</span>
            {versionCount > 1 && <span className="shrink-0">· v{version + 1}</span>}
            {fact && <span className="min-w-0 truncate">· {fact}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-sm font-medium">
            <span className="min-w-0 truncate">{artifact.title}</span>
            {href && (
              <ActionTip label="Open in new tab" side="top">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open in new tab"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </ActionTip>
            )}
          </div>
          {artifact.summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{artifact.summary}</p>}
        </div>
        <ActionTip label={panelAction} side="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onPanel) close();
              else open();
            }}
            aria-label={panelAction}
            aria-pressed={onPanel}
            className={cn(ICON_BUTTON_CLASS, onPanel && "text-foreground")}
          >
            <PanelIcon className="h-4 w-4" />
          </button>
        </ActionTip>
      </div>
      <CardBody artifact={artifact} state={state} onOpen={open} />
    </div>
  );
});
