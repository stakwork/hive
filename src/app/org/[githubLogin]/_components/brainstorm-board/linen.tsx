"use client";

import type { CSSProperties } from "react";
import { useStore } from "@xyflow/react";

export const LINEN = "#ece3cf";

const FIBRE_TILE = 240;
const FIBRE_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${FIBRE_TILE}' height='${FIBRE_TILE}'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>` +
  `<feColorMatrix values='0 0 0 0 .35  0 0 0 0 .27  0 0 0 0 .16  0 0 0 .2 0'/></filter>` +
  `<rect width='100%' height='100%' filter='url(#n)'/></svg>`;
const MOTTLE_TILE = 1100;
const MOTTLE_SVG =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${MOTTLE_TILE}' height='${MOTTLE_TILE}'>` +
  `<filter id='m'><feTurbulence type='fractalNoise' baseFrequency='.0045' numOctaves='3' seed='4' stitchTiles='stitch'/>` +
  `<feColorMatrix values='0 0 0 0 .55  0 0 0 0 .4  0 0 0 0 .2  0 0 0 .22 -.04'/></filter>` +
  `<rect width='100%' height='100%' filter='url(#m)'/></svg>`;
const url = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/**
 * The desk: linen-coloured paper with fine fibre and soft mottling, tiled in
 * the viewport's own transform (offset and size follow pan and zoom, like
 * xyflow's Background) so the paper moves with the cards. No weave: at
 * normal zoom a weave reads as graph paper.
 */
export function Linen() {
  const [x, y, zoom] = useStore((s) => s.transform);
  const style: CSSProperties = {
    backgroundColor: LINEN,
    backgroundImage: `${url(FIBRE_SVG)}, ${url(MOTTLE_SVG)}`,
    backgroundSize: `${FIBRE_TILE * zoom}px, ${MOTTLE_TILE * zoom}px`,
    backgroundPosition: `${x}px ${y}px`,
  };
  return <div className="pointer-events-none absolute inset-0 -z-10" style={style} data-linen />;
}
