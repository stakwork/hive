"use client";

import React, { useEffect, useRef, useState } from "react";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { PanelToolbar, ToolbarButton } from "../chrome";

function ImageUnavailable() {
  return <p className="px-3 py-6 text-center text-xs text-muted-foreground">This image could not be loaded.</p>;
}

// ─── Image ──────────────────────────────────────────────────────────────

export function ImageInline({ artifact, content }: ArtifactViewerProps<"image">) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ImageUnavailable />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={content.url}
      alt={content.alt ?? artifact.title}
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-64 w-full bg-muted/30 object-contain"
    />
  );
}

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
/** Room left around an image that is fitted to the panel. */
const FIT_MARGIN = 24;

interface Size {
  width: number;
  height: number;
}

/** The image fitted to the panel, with zoom for reading a screenshot's detail. */
export function ImagePanel({ artifact, content }: ArtifactViewerProps<"image">) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  /** A chosen scale, or null to fit the panel. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitScale =
    natural && viewport && natural.width > 0 && natural.height > 0
      ? Math.min(
          1,
          (viewport.width - FIT_MARGIN * 2) / natural.width,
          (viewport.height - FIT_MARGIN * 2) / natural.height,
        )
      : null;
  const scale = zoom ?? fitScale;
  const larger = scale === null ? undefined : ZOOM_STEPS.find((step) => step > scale + 0.001);
  const smaller = scale === null ? undefined : ZOOM_STEPS.findLast((step) => step < scale - 0.001);

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <ToolbarButton label="Zoom out" onClick={() => smaller && setZoom(smaller)} disabled={!smaller}>
          <ZoomOut className="h-4 w-4" />
        </ToolbarButton>
        <span className="w-10 text-center tabular-nums text-muted-foreground">
          {scale === null ? "" : `${Math.round(scale * 100)}%`}
        </span>
        <ToolbarButton label="Zoom in" onClick={() => larger && setZoom(larger)} disabled={!larger}>
          <ZoomIn className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Fit to panel" onClick={() => setZoom(null)} pressed={zoom === null}>
          <Scan className="h-4 w-4" />
        </ToolbarButton>
        {natural && (
          <span className="ml-auto pr-1 tabular-nums text-muted-foreground">
            {natural.width} × {natural.height}
          </span>
        )}
      </PanelToolbar>
      <div ref={viewportRef} className="flex min-h-0 flex-1 overflow-auto bg-muted/30">
        {failed ? (
          <div className="m-auto">
            <ImageUnavailable />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={content.url}
            alt={content.alt ?? artifact.title}
            draggable={false}
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            onDoubleClick={() => setZoom(zoom === null ? 1 : null)}
            style={
              natural && scale !== null
                ? { width: natural.width * scale, height: natural.height * scale }
                : { maxWidth: "100%", maxHeight: "100%" }
            }
            className="m-auto block max-w-none shrink-0 object-contain shadow-sm ring-1 ring-border"
          />
        )}
      </div>
    </div>
  );
}

// ─── Video ──────────────────────────────────────────────────────────────

export function VideoInline({ content }: ArtifactViewerProps<"video">) {
  return (
    <video src={content.url} poster={content.poster} controls preload="metadata" className="max-h-64 w-full bg-black" />
  );
}

export function VideoPanel({ content }: ArtifactViewerProps<"video">) {
  return (
    <video
      src={content.url}
      poster={content.poster}
      controls
      preload="metadata"
      className="h-full w-full bg-black object-contain"
    />
  );
}

// ─── Audio ──────────────────────────────────────────────────────────────

/** The browser draws its own player; this has it follow the app's theme rather than the system's. */
const PLAYER_THEME = "[color-scheme:light] [.dark_&]:[color-scheme:dark]";

export function AudioInline({ content }: ArtifactViewerProps<"audio">) {
  return (
    <div className="px-3 py-2.5">
      <audio src={content.url} controls preload="metadata" className={cn("h-9 w-full", PLAYER_THEME)} />
    </div>
  );
}

/** Sound has nothing to show, so the panel is the same player with room around it. */
export function AudioPanel({ content }: ArtifactViewerProps<"audio">) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <audio src={content.url} controls preload="metadata" className={cn("w-full max-w-xl", PLAYER_THEME)} />
    </div>
  );
}
