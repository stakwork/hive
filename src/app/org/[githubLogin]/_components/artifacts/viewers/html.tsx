"use client";

import React from "react";
import { HtmlArtifactFrame, type HtmlArtifactSource } from "@/components/html-artifact/HtmlArtifactFrame";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useChatOrgLogin } from "../useArtifactPanel";
import { useHtmlPageStamp } from "../useHtmlPageStamp";

/** Where the frame reads the page from: a stored page by its slug, or a page a strut job wrote by where it is on the swarm. */
const frameSource = (content: ArtifactContents["html"], githubLogin: string): HtmlArtifactSource =>
  "slug" in content ? { githubLogin, slug: content.slug } : { githubLogin, swarmId: content.swarmId, key: content.key };

/** The version a frame refetches on: a stored page's `updatedAt`, a swarm page's last-modified stamp when the reader gave one. */
export const updatedAtOf = (content: ArtifactContents["html"]): string | undefined => content.updatedAt;

export function HtmlPanel({ artifact, content }: ArtifactViewerProps<"html">) {
  const githubLogin = useChatOrgLogin();
  // A stored page is rewritten in place; the org channel says when.
  const updatedAt = useHtmlPageStamp(githubLogin, "slug" in content ? content.slug : null, updatedAtOf(content));
  return <HtmlArtifactFrame source={frameSource(content, githubLogin)} title={artifact.title} updatedAt={updatedAt} />;
}
