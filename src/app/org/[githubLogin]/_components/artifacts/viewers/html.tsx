"use client";

import React from "react";
import { HtmlArtifactFrame, type HtmlArtifactSource } from "@/components/html-artifact/HtmlArtifactFrame";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "../useArtifactPanel";

/** Where the frame reads the page from: a stored page by its slug, or a page a strut job wrote by where it is on the swarm. */
const frameSource = (content: ArtifactContents["html"], githubLogin: string): HtmlArtifactSource =>
  "slug" in content ? { githubLogin, slug: content.slug } : { githubLogin, swarmId: content.swarmId, key: content.key };

/** A stored page re-fetches when it was patched; a page on a swarm is read fresh each time the frame mounts. */
const updatedAtOf = (content: ArtifactContents["html"]): string | undefined => ("slug" in content ? content.updatedAt : undefined);

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
