"use client";

import { useEffect, type CSSProperties } from "react";
import { useStore } from "@xyflow/react";

export const LINEN = "#efe8da";

const NOISE_TILE = 240;
const NOISE_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${NOISE_TILE}' height='${NOISE_TILE}'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/>` +
  `<feColorMatrix values='0 0 0 0 .35  0 0 0 0 .28  0 0 0 0 .18  0 0 0 .24 0'/></filter>` +
  `<rect width='100%' height='100%' filter='url(#n)'/></svg>`;
const NOISE_URL = `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;
const WEAVE = 7;
const THREAD = "rgba(110,90,60,.075)";

/**
 * The board's linen: fractal noise and faint woven lines, tiled in the
 * viewport's own transform (offset and size follow pan and zoom, like xyflow's
 * Background) so the cloth moves with the cards.
 */
export function Linen() {
  const [x, y, zoom] = useStore((s) => s.transform);
  const weave = WEAVE * zoom;
  const showWeave = weave >= 3.5;
  const style: CSSProperties = {
    backgroundColor: LINEN,
    backgroundImage: [NOISE_URL, ...(showWeave ? [`linear-gradient(${THREAD} 1px, transparent 1px)`, `linear-gradient(90deg, ${THREAD} 1px, transparent 1px)`] : [])].join(", "),
    backgroundSize: [`${NOISE_TILE * zoom}px`, ...(showWeave ? [`${weave}px ${weave}px`, `${weave}px ${weave}px`] : [])].join(", "),
    backgroundPosition: `${x}px ${y}px`,
  };
  return <div className="pointer-events-none absolute inset-0 -z-10" style={style} data-linen />;
}

/** Publishes the zoom as `--bb-zoom` on the flow's root element, so cards can counter-scale without re-rendering. */
export function ZoomVar() {
  const zoom = useStore((s) => s.transform[2]);
  const dom = useStore((s) => s.domNode);
  useEffect(() => {
    dom?.style.setProperty("--bb-zoom", String(zoom));
  }, [dom, zoom]);
  return null;
}
