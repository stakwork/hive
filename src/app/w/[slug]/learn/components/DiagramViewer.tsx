"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { renderMermaidToSvg } from "@/lib/diagrams/mermaid-renderer";
import { ZoomIn, ZoomOut, Maximize, Minimize2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ── constants ─────────────────────────────────────────── */

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6.5;
const MAX_INITIAL_ZOOM = 1.8;
const ZOOM_STEP = 0.14;
const FIT_PADDING = 28;
/** If contain-fit zoom falls below this, switch to width/height priority */
const READABILITY_FLOOR = 0.58;

/* ── helpers ───────────────────────────────────────────── */

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/**
 * Read the SVG's natural (authored) size from viewBox, then
 * width/height attrs, then getBBox, then getBoundingClientRect.
 * Ensures a viewBox is always set for consistent scaling.
 */
function readSvgNaturalSize(svg: SVGSVGElement): { w: number; h: number } {
  let w = 0;
  let h = 0;

  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0) {
    w = vb.width;
    h = vb.height;
  }

  if (!w) {
    w = parseFloat(svg.getAttribute("width") ?? "0") || 0;
    h = parseFloat(svg.getAttribute("height") ?? "0") || 0;
  }

  if (!w) {
    try {
      const bb = svg.getBBox();
      w = bb.width;
      h = bb.height;
    } catch {
      // getBBox can throw if not in DOM
    }
  }

  if (!w) {
    const r = svg.getBoundingClientRect();
    w = r.width || 800;
    h = r.height || 600;
  }

  if (!svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  return { w, h };
}

/* ── component ─────────────────────────────────────────── */

interface DiagramViewerProps {
  name: string;
  body: string;
  description?: string | null;
  hideHeader?: boolean;
}

/**
 * Pan/zoom model (matches template.html):
 *
 * Zoom is applied by setting the SVG's CSS width/height to
 * `svgW * zoom` × `svgH * zoom`. The SVG's viewBox→viewport
 * mapping does the actual scaling, keeping text crisp.
 *
 * Pan is applied via `transform: translate(panX, panY)` on
 * the canvas div. Pan values are in screen pixels.
 */
export function DiagramViewer({ name, body, description, hideHeader = false }: DiagramViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  const [svgHtml, setSvgHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // mutable transform state — NOT React state, because
  // setState would re-render and dangerouslySetInnerHTML
  // would nuke our DOM mutations on the SVG element.
  const zoomRef = useRef(1);
  const panX = useRef(0);
  const panY = useRef(0);
  const svgW = useRef(0);
  const svgH = useRef(0);

  // drag state
  const dragStart = useRef<{
    mx: number; my: number; px: number; py: number;
  } | null>(null);
  // pinch state
  const pinchStart = useRef<{
    dist: number; cx: number; cy: number;
  } | null>(null);

  /* ── constrain pan so diagram can't be dragged fully off-screen ── */

  const constrainPan = useCallback(() => {
    const vp = containerRef.current;
    if (!vp || !svgW.current) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const rW = svgW.current * zoomRef.current;
    const rH = svgH.current * zoomRef.current;
    const pad = FIT_PADDING;

    panX.current =
      rW + pad * 2 <= vpW
        ? (vpW - rW) / 2
        : clamp(panX.current, vpW - rW - pad, pad);
    panY.current =
      rH + pad * 2 <= vpH
        ? (vpH - rH) / 2
        : clamp(panY.current, vpH - rH - pad, pad);
  }, []);

  /* ── flush transform to DOM ──────────────────────────── */

  const flush = useCallback(() => {
    const canvas = canvasRef.current;
    const svg = canvas?.querySelector("svg");
    if (!canvas || !svg || !svgW.current) return;

    constrainPan();

    // Zoom by setting CSS width/height — the SVG's viewBox mapping
    // scales content natively (crisp text at any zoom).
    svg.style.width = `${svgW.current * zoomRef.current}px`;
    svg.style.height = `${svgH.current * zoomRef.current}px`;

    // Pan via translate on the canvas wrapper
    canvas.style.transform = `translate(${panX.current}px, ${panY.current}px)`;

    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(zoomRef.current * 100)}%`;
    }
  }, [constrainPan]);

  /* ── can pan? (diagram larger than viewport) ─────────── */

  const canPan = useCallback((): boolean => {
    const vp = containerRef.current;
    if (!vp || !svgW.current) return false;
    const rW = svgW.current * zoomRef.current;
    const rH = svgH.current * zoomRef.current;
    return (
      rW + FIT_PADDING * 2 > vp.clientWidth ||
      rH + FIT_PADDING * 2 > vp.clientHeight
    );
  }, []);

  /* ── smart fit ───────────────────────────────────────── */

  const computeSmartFit = useCallback((): {
    zoom: number; mode: string;
  } => {
    const vp = containerRef.current;
    if (!vp || !svgW.current) return { zoom: 1, mode: "contain" };
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const aW = Math.max(80, vpW - FIT_PADDING * 2);
    const aH = Math.max(80, vpH - FIT_PADDING * 2);
    const contain = Math.min(aW / svgW.current, aH / svgH.current);

    let z = contain;
    let mode = "contain";
    if (contain < READABILITY_FLOOR) {
      const chartR = svgH.current / svgW.current;
      const vpR = vpH / Math.max(vpW, 1);
      if (chartR >= vpR) {
        z = aW / svgW.current;
        mode = "width-priority";
      } else {
        z = aH / svgH.current;
        mode = "height-priority";
      }
    }
    return { zoom: clamp(z, MIN_ZOOM, MAX_INITIAL_ZOOM), mode };
  }, []);

  /* ── fit to viewport ─────────────────────────────────── */

  const fitToView = useCallback(() => {
    if (!svgW.current) return;
    const fit = computeSmartFit();
    zoomRef.current = fit.zoom;
    const vp = containerRef.current;
    if (!vp) return;
    panX.current = (vp.clientWidth - svgW.current * fit.zoom) / 2;
    panY.current = (vp.clientHeight - svgH.current * fit.zoom) / 2;
    flush();
  }, [computeSmartFit, flush]);

  /* ── zoom around point ───────────────────────────────── */

  const zoomAround = useCallback(
    (factor: number, cx: number, cy: number) => {
      const next = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = next / zoomRef.current;
      panX.current = cx - ratio * (cx - panX.current);
      panY.current = cy - ratio * (cy - panY.current);
      zoomRef.current = next;
      flush();
    },
    [flush]
  );

  /* ── mermaid render ──────────────────────────────────── */

  useEffect(() => {
    const signal = { cancelled: false };
    setSvgHtml("");
    setError(null);
    (async () => {
      try {
        const result = await renderMermaidToSvg(body);
        if (!signal.cancelled) setSvgHtml(result);
      } catch (err) {
        if (!signal.cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to render diagram"
          );
      }
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [body]);

  /* ── measure SVG after inject, then fit ──────────────── */

  const fitToViewRef = useRef(fitToView);
  fitToViewRef.current = fitToView;

  useEffect(() => {
    if (!svgHtml) return;
    let cancelled = false;
    // Tracks the SVG element we last sized. When it's replaced
    // (e.g. a parent re-render reapplies `dangerouslySetInnerHTML`,
    // which can happen on Fast Refresh, prop-identity changes, or
    // React reconciliation quirks), the fresh node is unstyled
    // and renders at the SVG default 300×150. We detect the swap
    // via a MutationObserver and re-run measureAndFit so the new
    // node gets the same width/height our model expects.
    let lastSvg: SVGSVGElement | null = null;

    function measureAndFit() {
      if (cancelled) return;

      const canvas = canvasRef.current;
      const ct = containerRef.current;
      const svg = canvas?.querySelector("svg") as SVGSVGElement | null;
      if (!svg || !ct) return;

      if (ct.clientWidth === 0 || ct.clientHeight === 0) {
        requestAnimationFrame(measureAndFit);
        return;
      }

      lastSvg = svg;

      const size = readSvgNaturalSize(svg);
      svgW.current = size.w;
      svgH.current = size.h;

      // Remove Mermaid's width="100%"/max-width and let our
      // CSS width/height control the rendered size.
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.maxWidth = "none";
      svg.style.display = "block";

      fitToViewRef.current();
    }

    requestAnimationFrame(measureAndFit);

    // Watch for the SVG element being replaced. Without this,
    // a swap leaves the new SVG with mermaid's default attrs
    // (`width="100%"`, no inline size), which inside our auto-
    // sized canvas div collapses to the SVG default 300×150 — the
    // "diagram pops out tiny" symptom.
    const canvas = canvasRef.current;
    let mo: MutationObserver | null = null;
    if (canvas) {
      mo = new MutationObserver(() => {
        if (cancelled) return;
        const current = canvas.querySelector("svg") as SVGSVGElement | null;
        if (current && current !== lastSvg) measureAndFit();
      });
      mo.observe(canvas, { childList: true });
    }

    return () => {
      cancelled = true;
      mo?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgHtml]);

  /* ── resize observer ─────────────────────────────────── */

  useEffect(() => {
    const ct = containerRef.current;
    if (!ct) return;
    const ro = new ResizeObserver(() => {
      if (svgW.current) fitToViewRef.current();
    });
    ro.observe(ct);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── wheel: scroll = zoom ────────────────────────────── */

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: WheelEvent) => {
      if (!svgW.current) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const factor =
        e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
      zoomAround(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener("wheel", handler, { passive: false });
    return () => vp.removeEventListener("wheel", handler);
  }, [zoomAround, flush]);

  /* ── mouse drag ──────────────────────────────────────── */

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("[data-zoom-controls]")) return;
      e.preventDefault();
      containerRef.current?.classList.add("cursor-grabbing");
      containerRef.current?.classList.remove("cursor-grab");
      dragStart.current = {
        mx: e.clientX,
        my: e.clientY,
        px: panX.current,
        py: panY.current,
      };
    },
    []
  );

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragStart.current;
      if (!d) return;
      panX.current = d.px + (e.clientX - d.mx);
      panY.current = d.py + (e.clientY - d.my);
      flush();
    };
    const up = () => {
      if (!dragStart.current) return;
      dragStart.current = null;
      containerRef.current?.classList.remove("cursor-grabbing");
      containerRef.current?.classList.add("cursor-grab");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [flush]);

  /* ── touch ───────────────────────────────────────────── */

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 1) {
        dragStart.current = {
          mx: e.touches[0].clientX,
          my: e.touches[0].clientY,
          px: panX.current,
          py: panY.current,
        };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const rect = containerRef.current!.getBoundingClientRect();
        pinchStart.current = {
          dist: Math.sqrt(dx * dx + dy * dy),
          cx:
            (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          cy:
            (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
        };
      }
    },
    []
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 1 && dragStart.current) {
        e.preventDefault();
        panX.current =
          dragStart.current.px +
          (e.touches[0].clientX - dragStart.current.mx);
        panY.current =
          dragStart.current.py +
          (e.touches[0].clientY - dragStart.current.my);
        flush();
      } else if (e.touches.length === 2 && pinchStart.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        zoomAround(
          dist / pinchStart.current.dist,
          pinchStart.current.cx,
          pinchStart.current.cy
        );
        pinchStart.current.dist = dist;
      }
    },
    [flush, zoomAround]
  );

  const onTouchEnd = useCallback(() => {
    dragStart.current = null;
    pinchStart.current = null;
  }, []);

  /* ── copy handler ────────────────────────────────────── */

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [body]);

  /* ── button handlers ─────────────────────────────────── */

  const vpCenter = (): [number, number] => {
    const el = containerRef.current;
    return el ? [el.clientWidth / 2, el.clientHeight / 2] : [0, 0];
  };

  const onZoomIn = useCallback(() => {
    const [cx, cy] = vpCenter();
    zoomAround(1 + ZOOM_STEP, cx, cy);
  }, [zoomAround]);

  const onZoomOut = useCallback(() => {
    const [cx, cy] = vpCenter();
    zoomAround(1 / (1 + ZOOM_STEP), cx, cy);
  }, [zoomAround]);

  const onZoomOne = useCallback(() => {
    zoomRef.current = clamp(1, MIN_ZOOM, MAX_ZOOM);
    const vp = containerRef.current;
    if (vp && svgW.current) {
      panX.current = (vp.clientWidth - svgW.current) / 2;
      panY.current = (vp.clientHeight - svgH.current) / 2;
    }
    flush();
  }, [flush]);

  /* ── JSX ─────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h1 className="text-2xl font-semibold">{name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {description || "Diagram"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy diagram source"}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-hidden p-6">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive mb-2">
              Failed to render diagram
            </p>
            <p className="text-xs text-destructive/70 mb-2">{error}</p>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
              {body}
            </pre>
          </div>
        ) : !svgHtml ? (
          <div className="flex items-center justify-center h-full bg-muted/30 rounded-md">
            <div className="animate-pulse text-sm text-muted-foreground">
              Loading diagram...
            </div>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="relative h-full rounded-md border border-border bg-muted/30 overflow-hidden select-none cursor-grab"
          >
            {/* Controls */}
            <div
              data-zoom-controls
              className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/90 backdrop-blur-sm p-0.5"
            >
              {(
                [
                  [onZoomIn, "Zoom in", ZoomIn],
                  [onZoomOut, "Zoom out", ZoomOut],
                  [fitToView, "Fit to view", Maximize],
                  [onZoomOne, "1 : 1", Minimize2],
                ] as const
              ).map(([handler, title, Icon], i) => (
                <button
                  key={i}
                  type="button"
                  onClick={handler}
                  title={title}
                  className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
              <span
                ref={zoomLabelRef}
                className="px-1.5 text-[10px] font-mono text-muted-foreground select-none"
              >
                100%
              </span>
            </div>

            {/* Hint */}
            <p className="absolute bottom-2 left-2 z-10 text-[10px] font-mono text-muted-foreground/50 select-none pointer-events-none">
              Scroll to zoom · Drag to pan · Double-click to fit
            </p>

            {/* Viewport */}
            <div
              ref={viewportRef}
              className="relative w-full h-full overflow-hidden"
              onMouseDown={onMouseDown}
              onDoubleClick={fitToView}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <div
                ref={canvasRef}
                className="absolute top-0 left-0 [&_svg]:block"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
