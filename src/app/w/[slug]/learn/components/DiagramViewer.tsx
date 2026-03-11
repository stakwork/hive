"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { renderMermaidToSvg } from "@/lib/diagrams/mermaid-renderer";
import { ZoomIn, ZoomOut, Maximize, Minimize2 } from "lucide-react";

/* ── constants ─────────────────────────────────────────── */

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.003;
const ZOOM_BUTTON_FACTOR = 1.3;
const FIT_PADDING = 32;

/* ── helpers ───────────────────────────────────────────── */

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

function getSvgNaturalSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0) return { w: vb.width, h: vb.height };
  const aw = parseFloat(svg.getAttribute("width") ?? "0");
  const ah = parseFloat(svg.getAttribute("height") ?? "0");
  if (aw > 0) return { w: aw, h: ah };
  const bb = svg.getBBox();
  if (bb.width > 0) return { w: bb.width, h: bb.height };
  return { w: 800, h: 600 };
}

/* ── component ─────────────────────────────────────────── */

interface DiagramViewerProps {
  name: string;
  body: string;
  description?: string | null;
}

/**
 * Pan/zoom model:
 *
 * The canvas div gets `transform-origin: 0 0` and
 * `transform: translate(panX, panY) scale(zoom)`.
 *
 * The SVG inside keeps its natural (viewBox) size — zoom is
 * handled entirely by the CSS scale. Pan is in **screen pixels**.
 *
 * "Zoom around point (cx, cy) in viewport coords" uses the
 * standard formula:
 *   panX' = cx - (cx - panX) * (newZoom / oldZoom)
 *   panY' = cy - (cy - panY) * (newZoom / oldZoom)
 */
export function DiagramViewer({ name, body, description }: DiagramViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [svgHtml, setSvgHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [zoomPct, setZoomPct] = useState("100%");
  const [isPanning, setIsPanning] = useState(false);

  // mutable transform state
  const zoom = useRef(1);
  const panX = useRef(0);
  const panY = useRef(0);
  const svgW = useRef(0);
  const svgH = useRef(0);

  // drag state
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  // pinch state
  const pinchStart = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  /* ── flush transform to DOM ──────────────────────────── */

  const flush = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transform = `translate(${panX.current}px, ${panY.current}px) scale(${zoom.current})`;
    setZoomPct(`${Math.round(zoom.current * 100)}%`);
  }, []);

  /* ── fit to viewport ─────────────────────────────────── */

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !svgW.current) return;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    const z = clamp(
      Math.min(
        (vpW - FIT_PADDING * 2) / svgW.current,
        (vpH - FIT_PADDING * 2) / svgH.current
      ),
      MIN_ZOOM,
      MAX_ZOOM
    );
    zoom.current = z;
    panX.current = (vpW - svgW.current * z) / 2;
    panY.current = (vpH - svgH.current * z) / 2;
    flush();
  }, [flush]);

  /* ── zoom to absolute level around viewport point ────── */

  const zoomTo = useCallback(
    (next: number, cx: number, cy: number) => {
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
      const ratio = z / zoom.current;
      panX.current = cx - (cx - panX.current) * ratio;
      panY.current = cy - (cy - panY.current) * ratio;
      zoom.current = z;
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
          setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    })();
    return () => { signal.cancelled = true; };
  }, [body]);

  /* ── measure SVG after inject, then fit ──────────────── */

  useEffect(() => {
    if (!svgHtml) return;
    requestAnimationFrame(() => {
      const svg = canvasRef.current?.querySelector("svg");
      if (!svg) return;
      const size = getSvgNaturalSize(svg);
      svgW.current = size.w;
      svgH.current = size.h;

      // Ensure viewBox is set, then let CSS scale handle sizing
      if (!svg.getAttribute("viewBox")) {
        svg.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
      }
      svg.setAttribute("width", String(size.w));
      svg.setAttribute("height", String(size.h));
      svg.style.display = "block";

      fitToView();
    });
  }, [svgHtml, fitToView]);

  /* ── resize observer ─────────────────────────────────── */

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => { if (svgW.current) fitToView(); });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fitToView]);

  /* ── wheel: scroll = pan, ctrl/cmd+scroll = zoom ─────── */

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: WheelEvent) => {
      if (!svgW.current) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = vp.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
        zoomTo(zoom.current * factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        panX.current -= e.deltaX;
        panY.current -= e.deltaY;
        flush();
      }
    };
    vp.addEventListener("wheel", handler, { passive: false });
    return () => vp.removeEventListener("wheel", handler);
  }, [zoomTo, flush]);

  /* ── mouse drag ──────────────────────────────────────── */

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-zoom-controls]")) return;
    e.preventDefault();
    setIsPanning(true);
    dragStart.current = {
      mx: e.clientX, my: e.clientY,
      px: panX.current, py: panY.current,
    };
  }, []);

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
      setIsPanning(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [flush]);

  /* ── touch ───────────────────────────────────────────── */

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      dragStart.current = {
        mx: e.touches[0].clientX, my: e.touches[0].clientY,
        px: panX.current, py: panY.current,
      };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const rect = viewportRef.current!.getBoundingClientRect();
      pinchStart.current = {
        dist: Math.sqrt(dx * dx + dy * dy),
        cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
        cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
      };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1 && dragStart.current) {
      e.preventDefault();
      panX.current = dragStart.current.px + (e.touches[0].clientX - dragStart.current.mx);
      panY.current = dragStart.current.py + (e.touches[0].clientY - dragStart.current.my);
      flush();
    } else if (e.touches.length === 2 && pinchStart.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      zoomTo(zoom.current * (dist / pinchStart.current.dist), pinchStart.current.cx, pinchStart.current.cy);
      pinchStart.current.dist = dist;
    }
  }, [flush, zoomTo]);

  const onTouchEnd = useCallback(() => {
    dragStart.current = null;
    pinchStart.current = null;
  }, []);

  /* ── button handlers ─────────────────────────────────── */

  const vpCenter = (): [number, number] => {
    const vp = viewportRef.current;
    return vp ? [vp.clientWidth / 2, vp.clientHeight / 2] : [0, 0];
  };

  const onZoomIn = useCallback(() => { const [cx, cy] = vpCenter(); zoomTo(zoom.current * ZOOM_BUTTON_FACTOR, cx, cy); }, [zoomTo]);
  const onZoomOut = useCallback(() => { const [cx, cy] = vpCenter(); zoomTo(zoom.current / ZOOM_BUTTON_FACTOR, cx, cy); }, [zoomTo]);
  const onZoomOne = useCallback(() => { const [cx, cy] = vpCenter(); zoomTo(1, cx, cy); }, [zoomTo]);

  /* ── JSX ─────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {description || "Diagram"}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden p-6">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive mb-2">Failed to render diagram</p>
            <p className="text-xs text-destructive/70 mb-2">{error}</p>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{body}</pre>
          </div>
        ) : !svgHtml ? (
          <div className="flex items-center justify-center h-full bg-muted/30 rounded-md">
            <div className="animate-pulse text-sm text-muted-foreground">Loading diagram...</div>
          </div>
        ) : (
          <div className={cn(
            "relative h-full rounded-md border border-border bg-muted/30 overflow-hidden select-none",
            isPanning ? "cursor-grabbing" : "cursor-grab"
          )}>
            {/* Controls */}
            <div
              data-zoom-controls
              className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/90 backdrop-blur-sm p-0.5"
            >
              {([
                [onZoomIn, "Zoom in", ZoomIn],
                [onZoomOut, "Zoom out", ZoomOut],
                [fitToView, "Fit to view", Maximize],
                [onZoomOne, "1 : 1", Minimize2],
              ] as const).map(([handler, title, Icon], i) => (
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
              <span className="px-1.5 text-[10px] font-mono text-muted-foreground select-none">
                {zoomPct}
              </span>
            </div>

            {/* Hint */}
            <p className="absolute bottom-2 left-2 z-10 text-[10px] font-mono text-muted-foreground/50 select-none pointer-events-none">
              Scroll to pan · Ctrl+wheel to zoom · Drag to pan · Double-click to fit
            </p>

            {/* Viewport */}
            <div
              ref={viewportRef}
              className="w-full h-full overflow-hidden"
              onMouseDown={onMouseDown}
              onDoubleClick={fitToView}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <div
                ref={canvasRef}
                className="origin-top-left [&_svg]:block"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
