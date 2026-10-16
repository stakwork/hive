"use client";

import { usePathname, useSearchParams } from "next/navigation";

/** `ops` — Gateway and Advisor, both behind the rail's Ops menu. */
export type OrgView = "chats" | "canvas" | "strut" | "ops" | "canvas-demo" | "graph" | "settings";

/** Params that only mean something to the canvas: a sub-canvas, a research doc, a node. */
const CANVAS_PARAMS = ["canvas", "r", "node", "select"];

/**
 * Which view of the org page itself the URL asks for. `?view=` names it;
 * without one, a canvas-only param (an older link, or one Jamie wrote)
 * still lands on the canvas; otherwise chats, the default.
 */
export function orgPageView(params: Pick<URLSearchParams, "get"> | null): "chats" | "canvas" | "graph" {
  const view = params?.get("view");
  if (view === "canvas" || view === "graph") return view;
  if (!view && CANVAS_PARAMS.some((key) => params?.get(key))) return "canvas";
  return "chats";
}

export type CanvasTab = "map" | "initiatives";

/** The canvas view's tab, from `?tab=`; the map by default. */
export function canvasTab(params: Pick<URLSearchParams, "get"> | null): CanvasTab {
  return params?.get("tab") === "initiatives" ? "initiatives" : "map";
}

/** The org page's URL on the canvas view, carrying over the current params (the open chat among them) plus `patch`. */
export function canvasViewHref(
  pathname: string,
  current: Pick<URLSearchParams, "toString">,
  patch: Record<string, string>,
): string {
  const params = new URLSearchParams(current.toString());
  params.set("view", "canvas");
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return `${pathname}?${params.toString()}`;
}

/**
 * Map the current pathname to a logical view id. Used by `OrgShell` to
 * decide what to render in the content slot and which icon in the
 * rail is active.
 */
export function useOrgView(githubLogin: string): OrgView {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const base = `/org/${githubLogin}`;
  // Chats (the default), the canvas and the graph are views of the org page itself (`?view=`).
  if (pathname === base || pathname === `${base}/`) return orgPageView(searchParams);
  if (pathname.startsWith(`${base}/strut`)) return "strut";
  if (pathname.startsWith(`${base}/advisor`) || pathname.startsWith(`${base}/gateway`)) return "ops";
  if (pathname.startsWith(`${base}/canvas-demo`)) return "canvas-demo";
  if (pathname.startsWith(`${base}/graph`)) return "graph";
  if (pathname.startsWith(`${base}/settings`)) return "settings";
  return "canvas";
}
