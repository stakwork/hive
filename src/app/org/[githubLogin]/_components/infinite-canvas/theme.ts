import type { CSSProperties } from "react";
import type { Camera, Viewport } from "./scene";

/**
 * The canvas's colours, in one place. Every colour on the canvas is one of
 * these tokens, read as a CSS variable (`v("ink")` → `var(--ic-ink)`), so a
 * theme is just a set of values on the canvas root. Colour is state, never
 * decoration: blue a job running or in progress, green done or accepted,
 * amber blocked or waiting on you, red failing CI and nothing else, the fork
 * colour a brainstorm and its chosen option, grey dashed or struck proposed
 * or dropped. The interface matches the theme explorations, so the theme
 * chosen there drops in as another `Tokens` value.
 */
export interface Tokens {
  /** The desk under everything, and how it's textured. */
  desk: string;
  texture: "linen" | "grain" | "grid" | "dots" | "none";
  /** Texture ink as "r,g,b": fibre/grain colour, grid or dot lines. */
  textureInk: string;

  /** Card kinds. */
  card: string;
  cardInitiative: string;
  /** A question card: a sticky note in the light themes, a tinted panel in the dark ones. */
  question: string;
  /** An unchosen option. */
  option: string;
  /** Popovers, ⌘K, artifact viewer. */
  sheet: string;
  /** The full chat panel. */
  panel: string;
  /** Translucent chrome over the canvas: top buttons, zoom buttons, Jamie bar. */
  chrome: string;
  chromeBorder: string;
  /** Inputs, pills, the row under the cursor. */
  field: string;
  fieldInk: string;
  /** Your own message in the chat. */
  bubble: string;
  border: string;
  borderStrong: string;

  /** Text. */
  ink: string;
  inkSoft: string;
  muted: string;
  /** Small caps labels, breadcrumb separators: the faintest text that still passes 4.5:1 on a card. */
  faint: string;
  /** Text on an ink-filled button (the orb, Send, "Accept"). */
  onInk: string;

  /** Roads, "+ Add", and the outline of the level you're in. */
  road: string;
  /** The open level's frame: outline colour, and its fill. */
  frame: string;
  frameFill: string;
  frameFillInitiative: string;
  /** The level you're in gets this outline, stronger than its neighbours. */
  here: string;

  /** Brainstorms: the question's edge, option letters, the chosen option. */
  fork: string;
  onFork: string;
  con: string;

  /** Work states. */
  notStarted: string;
  job: string;
  jobBg: string;
  jobBorder: string;
  done: string;
  onDone: string;
  blocked: string;
  blockedBg: string;
  blockedInk: string;
  blockedBorder: string;
  failing: string;

  /** Requirement states: proposed (pencil), dropped. Accepted is `done`. */
  proposedInk: string;
  dropped: string;

  /** The flash on a card you jumped to, and the keyboard focus ring. */
  flash: string;
  focus: string;

  shadow: string;
  shadowBig: string;
  shadowPop: string;
  scheme: "light" | "dark";
}

/** Today's linen desk. */
export const PAPER: Tokens = {
  desk: "#ece3cf",
  texture: "linen",
  textureInk: "90,69,41",
  card: "#fdfbf4",
  cardInitiative: "#f8f1dd",
  question: "#fdf2c4",
  option: "rgba(255,250,236,.9)",
  sheet: "#fbf8ee",
  panel: "#f7f1e1",
  chrome: "rgba(251,248,238,.95)",
  chromeBorder: "#d8cba8",
  field: "#ffffff",
  fieldInk: "#111111",
  bubble: "#ffffff",
  border: "#e6dcc3",
  borderStrong: "#cdbf9c",
  ink: "#2b261a",
  inkSoft: "#3b352b",
  muted: "#655b46",
  faint: "#7a6f56",
  onInk: "#fbf6e6",
  road: "#8a6a43",
  frame: "#8a6a43",
  frameFill: "rgba(253,250,240,.6)",
  frameFillInitiative: "rgba(250,244,226,.5)",
  here: "rgba(138,106,67,.45)",
  fork: "#a65806",
  onFork: "#ffffff",
  con: "#a0522d",
  notStarted: "#766f61",
  job: "#2563a8",
  jobBg: "#e3edf8",
  jobBorder: "#9cc0e6",
  done: "#2f7d4f",
  onDone: "#ffffff",
  blocked: "#c26a09",
  blockedBg: "#fbeedb",
  blockedInk: "#8a4b06",
  blockedBorder: "#e5c9a3",
  failing: "#b42318",
  proposedInk: "#5f5a50",
  dropped: "#8f8571",
  flash: "rgba(250,204,21,.38)",
  focus: "#2563a8",
  shadow: "0 1px 1px rgba(80,60,20,.08), 0 6px 16px rgba(80,60,20,.12)",
  shadowBig: "0 2px 2px rgba(80,60,20,.08), 0 24px 60px rgba(80,60,20,.16)",
  shadowPop: "0 2px 4px rgba(80,60,20,.1), 0 24px 60px rgba(80,60,20,.25)",
  scheme: "light",
};

/** The theme the canvas uses. */
export const CANVAS_THEME: Tokens = PAPER;

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A theme as CSS variables, for the canvas root. */
export const themeVars = (t: Tokens) =>
  Object.fromEntries(
    Object.entries(t)
      .filter(([k]) => k !== "texture" && k !== "scheme")
      .map(([k, val]) => [`--ic-${kebab(k)}`, val]),
  ) as CSSProperties;

/** `v("ink")` → `var(--ic-ink)`. */
export const v = (k: keyof Tokens) => `var(--ic-${kebab(k)})`;
/** A token at some opacity. */
export const a = (k: keyof Tokens, pct: number) => `color-mix(in srgb, ${v(k)} ${pct}%, transparent)`;

/** Paper fibre and mottle, tinted with the theme's texture ink ("r,g,b" 0–255). */
const fibre = (ink: string, alpha: number) => {
  const [r, g, b] = ink.split(",").map((c) => (Number(c) / 255).toFixed(3));
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
  );
};
const mottle = (ink: string, alpha: number) => {
  const [r, g, b] = ink.split(",").map((c) => (Number(c) / 255).toFixed(3));
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='1100' height='1100'><filter id='m'><feTurbulence type='fractalNoise' baseFrequency='.0045' numOctaves='3' seed='4' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${alpha} -.04'/></filter><rect width='100%' height='100%' filter='url(#m)'/></svg>`
  );
};
const svgUrl = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/** The desk's texture, pinned to the world so it pans and zooms with the cards. */
export function deskStyle(t: Tokens, cam: Camera | null, vp: Viewport | null): CSSProperties {
  if (!cam || !vp || t.texture === "none") return { backgroundColor: t.desk };
  const pos = `${-cam.cx * cam.z + vp.w / 2}px ${-cam.cy * cam.z + vp.h / 2}px`;
  const z = Math.min(4, Math.max(0.25, cam.z));
  const ink = (alpha: number) => `rgba(${t.textureInk},${alpha})`;
  if (t.texture === "linen" || t.texture === "grain") {
    const light = t.texture === "linen";
    return {
      backgroundColor: t.desk,
      backgroundImage: `${svgUrl(fibre(t.textureInk, light ? 0.2 : 0.06))}, ${svgUrl(mottle(t.textureInk, light ? 0.22 : 0.05))}`,
      backgroundSize: `240px, ${1100 * z}px`,
      backgroundPosition: pos,
    };
  }
  if (t.texture === "grid") {
    // A drafting sheet: a fine grid every 40 world units, a heavier line every 200.
    const minor = 40 * cam.z;
    const major = 200 * cam.z;
    const fine = minor >= 8;
    return {
      backgroundColor: t.desk,
      backgroundImage: [
        `linear-gradient(${ink(0.16)} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${ink(0.16)} 1px, transparent 1px)`,
        ...(fine
          ? [
              `linear-gradient(${ink(0.075)} 1px, transparent 1px)`,
              `linear-gradient(90deg, ${ink(0.075)} 1px, transparent 1px)`,
            ]
          : []),
      ].join(", "),
      backgroundSize: [
        `${major}px ${major}px`,
        `${major}px ${major}px`,
        ...(fine ? [`${minor}px ${minor}px`, `${minor}px ${minor}px`] : []),
      ].join(", "),
      backgroundPosition: pos,
    };
  }
  const step = 28 * Math.max(0.5, Math.min(2, cam.z));
  return {
    backgroundColor: t.desk,
    backgroundImage: `radial-gradient(${ink(0.07)} 1px, transparent 1.2px)`,
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: pos,
  };
}
