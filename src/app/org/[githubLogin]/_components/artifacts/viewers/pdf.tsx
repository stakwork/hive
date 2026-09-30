"use client";

import React from "react";
import { ArrowUpRight } from "lucide-react";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { framablePdfAddress, webAddress } from "../address";

/**
 * The document in the browser's own PDF viewer. A PDF somewhere else on
 * the web is not framed (see `framablePdfAddress`); it is offered as a
 * link instead. There is no card preview: a first page would need a PDF
 * renderer of our own.
 */
export function PdfPanel({ artifact, content }: ArtifactViewerProps<"pdf">) {
  const framable = framablePdfAddress(content.url);
  if (framable) {
    return (
      <iframe src={framable} title={artifact.title} referrerPolicy="no-referrer" className="h-full w-full border-0" />
    );
  }

  const elsewhere = webAddress(content.url);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {elsewhere ? (
        <>
          <p>This PDF is on another site, so it opens in its own tab.</p>
          <a
            href={elsewhere}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline underline-offset-4 hover:opacity-80"
          >
            Open the PDF
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </a>
        </>
      ) : (
        <p>This address is not a PDF that can be opened.</p>
      )}
    </div>
  );
}
