"use client";

import React, { useEffect, useRef, useState } from "react";
import { HtmlArtifactFrame, type HtmlArtifactSource } from "@/components/html-artifact/HtmlArtifactFrame";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "../useArtifactPanel";

/** The size a page is drawn at before it is scaled down into the card. */
const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 800;

/** Where the frame reads the page from: a stored page by its slug, or a page a strut job wrote by where it is on the swarm. */
const frameSource = (content: ArtifactContents["html"], githubLogin: string): HtmlArtifactSource =>
  "slug" in content ? { githubLogin, slug: content.slug } : { githubLogin, swarmId: content.swarmId, key: content.key };

/** A stored page re-fetches when it was patched; a page on a swarm is read fresh each time the frame mounts. */
const updatedAtOf = (content: ArtifactContents["html"]): string | undefined => ("slug" in content ? content.updatedAt : undefined);

/** The page drawn at desktop width and scaled to fit the card: something to recognise, not to click around in. */
export function HtmlInline({ artifact, content }: ArtifactViewerProps<"html">) {
  const githubLogin = useChatOrgLogin();
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A hidden chat tab has no width; the page already drawn stays as it is rather than being torn down.
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) setScale(el.clientWidth / THUMBNAIL_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: `${THUMBNAIL_WIDTH} / ${THUMBNAIL_HEIGHT}` }}
    >
      {scale > 0 && (
        <HtmlArtifactFrame
          source={frameSource(content, githubLogin)}
          title={artifact.title}
          updatedAt={updatedAtOf(content)}
          className="absolute inset-0"
          frameStyle={{
            width: THUMBNAIL_WIDTH,
            height: THUMBNAIL_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      )}
    </div>
  );
}

export function HtmlPanel({ artifact, content }: ArtifactViewerProps<"html">) {
  const githubLogin = useChatOrgLogin();
  return (
    <HtmlArtifactFrame
      source={frameSource(content, githubLogin)}
      title={artifact.title}
      updatedAt={updatedAtOf(content)}
    />
  );
}
