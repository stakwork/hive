"use client";

import React, { useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { useInView } from "framer-motion";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import {
  artifactIdentity,
  type ArtifactContents,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactVersion,
  type ArtifactViewerProps,
} from "../../_state/canvasChatArtifacts";
import { ViewerBoundary } from "./chrome";
import { FoldedArtifacts } from "./FoldedArtifacts";
import { artifactKind } from "./registry";
import { useArtifactContent } from "./useArtifactContent";
import { useOpenArtifact } from "./openArtifact";
import { useChatOrgLogin } from "./useArtifactPanel";

/** The reading width the artifacts keep under a message. */
const ARTIFACTS_WIDTH = "max-w-[560px]";

type Viewer = ComponentType<ArtifactViewerProps<ArtifactKind>>;

/**
 * A message's artifacts in the chat, by where their kind says they go
 * (`chat` in `artifacts/registry.ts`): rows for what to act on or open, a
 * strip of thumbnails for what to look at, the first lines of what to read,
 * and one quiet line for the reference material. Anything opens on the
 * artifact panel. A piece reads its content once it has been on screen, and
 * only when it draws some.
 */
export const ChatArtifacts = React.memo(
  function ChatArtifacts({
    artifacts,
    versions,
  }: {
    artifacts: ArtifactRef[];
    /** Each artifact's place among its versions, for "v2" on a revised one. */
    versions: Map<ArtifactRef, ArtifactVersion>;
  }) {
    const by = useMemo(() => {
      const groups = {
        row: [] as ArtifactRef[],
        media: [] as ArtifactRef[],
        preview: [] as ArtifactRef[],
        folded: [] as ArtifactRef[],
      };
      for (const artifact of artifacts) groups[artifactKind(artifact.kind).chat?.place ?? "folded"].push(artifact);
      return groups;
    }, [artifacts]);
    const versionOf = (artifact: ArtifactRef) => versions.get(artifact) ?? { index: 0, count: 1 };

    return (
      <div className="space-y-2">
        {by.row.length > 0 && (
          <div className={cn("divide-y overflow-hidden rounded-lg border bg-card", ARTIFACTS_WIDTH)}>
            {by.row.map((artifact) => (
              <ArtifactRow key={artifactIdentity(artifact)} artifact={artifact} {...versionOf(artifact)} />
            ))}
          </div>
        )}
        {by.media.length > 0 && (
          <div className={cn("flex gap-2 overflow-x-auto pb-1", ARTIFACTS_WIDTH)}>
            {by.media.map((artifact) => (
              <MediaTile key={artifactIdentity(artifact)} artifact={artifact} />
            ))}
          </div>
        )}
        {by.preview.map((artifact) => (
          <PreviewCard key={artifactIdentity(artifact)} artifact={artifact} {...versionOf(artifact)} />
        ))}
        {by.folded.length > 0 && (
          <FoldedArtifacts artifacts={by.folded} afterOthers={by.folded.length < artifacts.length} />
        )}
      </div>
    );
  },
  // The chat re-renders on every streamed chunk with fresh arrays and a fresh versions map: the same refs at the same versions are no change.
  (prev, next) =>
    prev.artifacts.length === next.artifacts.length &&
    prev.artifacts.every((artifact, i) => {
      const a = prev.versions.get(artifact);
      const b = next.versions.get(next.artifacts[i]);
      return artifact === next.artifacts[i] && a?.index === b?.index && a?.count === b?.count;
    }),
);

/**
 * A piece's button: it opens the artifact on the panel (a brainstorm tree, on the desk) and is pressed while
 * the panel has it. `View` draws the content, read once the piece has been on
 * screen — and not read at all for a piece that draws none.
 */
function ChatArtifactButton({
  artifact,
  View,
  className,
  pressedClassName,
  children,
}: {
  artifact: ArtifactRef;
  View: Viewer | undefined;
  className: string;
  pressedClassName: string;
  children: (view: ReactNode) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const seen = useInView(ref, { once: true });
  const state = useArtifactContent(artifact, seen && !!View);
  const identity = artifactIdentity(artifact);
  const open = useOpenArtifact(useChatOrgLogin());
  const onPanel = useCanvasChatStore((s) => s.artifactPanel?.identity === identity);
  const content = state.status === "ready" ? (state.content as ArtifactContents[ArtifactKind]) : null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => open(artifact, content)}
      aria-pressed={onPanel}
      data-artifact-id={artifact.id}
      className={cn("group text-left transition-colors", className, onPanel && pressedClassName)}
    >
      {children(
        View && content ? (
          <ViewerBoundary>
            <View artifact={artifact} content={content} />
          </ViewerBoundary>
        ) : null,
      )}
    </button>
  );
}

/** The kind's icon, the title, "v2" once revised, and what sits on the right. */
function TitleLine({ artifact, index, count, end }: { artifact: ArtifactRef; end: ReactNode } & ArtifactVersion) {
  const spec = artifactKind(artifact.kind);
  return (
    <span className="flex items-center gap-3 text-sm">
      <spec.Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
      {count > 1 && <span className="shrink-0 text-xs text-muted-foreground">v{index + 1}</span>}
      <span className="flex shrink-0 items-center text-xs text-muted-foreground">{end}</span>
    </span>
  );
}

/** Something to act on or open: its title, its state on the right. */
const ArtifactRow = React.memo(function ArtifactRow({
  artifact,
  ...version
}: { artifact: ArtifactRef } & ArtifactVersion) {
  const spec = artifactKind(artifact.kind);
  const Meta = spec.chat?.place === "row" ? (spec.chat.Meta as Viewer | undefined) : undefined;
  return (
    <ChatArtifactButton
      artifact={artifact}
      View={Meta}
      className="flex h-11 w-full items-center px-3 hover:bg-muted/50"
      pressedClassName="bg-muted"
    >
      {(meta) => (
        <span className="min-w-0 flex-1">
          <TitleLine artifact={artifact} {...version} end={meta ?? artifact.label ?? spec.label} />
        </span>
      )}
    </ChatArtifactButton>
  );
});

/** Something to look at: its thumbnail in the strip, its title under it. */
const MediaTile = React.memo(function MediaTile({ artifact }: { artifact: ArtifactRef }) {
  const spec = artifactKind(artifact.kind);
  const Thumb = spec.chat?.place === "media" ? (spec.chat.Thumb as Viewer) : undefined;
  return (
    <ChatArtifactButton
      artifact={artifact}
      View={Thumb}
      className="w-[132px] shrink-0"
      pressedClassName="[&>span:first-child]:border-foreground/40"
    >
      {(thumb) => (
        <>
          <span className="relative flex h-[84px] items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-colors group-hover:border-foreground/20">
            {/* Under the picture, so a picture that fails to load leaves the kind's icon. */}
            <spec.Icon aria-hidden className="absolute h-5 w-5 text-muted-foreground/60" />
            {thumb && <span className="relative h-full w-full">{thumb}</span>}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground group-aria-pressed:text-foreground">
            {artifact.title}
          </span>
        </>
      )}
    </ChatArtifactButton>
  );
});

/** Something to read: its title, then its first lines. */
const PreviewCard = React.memo(function PreviewCard({
  artifact,
  ...version
}: { artifact: ArtifactRef } & ArtifactVersion) {
  const spec = artifactKind(artifact.kind);
  const Lines = spec.chat?.place === "preview" ? (spec.chat.Lines as Viewer) : undefined;
  return (
    <ChatArtifactButton
      artifact={artifact}
      View={Lines}
      className={cn("block w-full rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/50", ARTIFACTS_WIDTH)}
      pressedClassName="bg-muted"
    >
      {(lines) => (
        <>
          <TitleLine artifact={artifact} {...version} end={artifact.label ?? spec.label} />
          {/* A glance at the document, not the document: nothing in it is followed from here. */}
          {lines && <span className="pointer-events-none mt-1 block pl-7 text-muted-foreground">{lines}</span>}
        </>
      )}
    </ChatArtifactButton>
  );
});
