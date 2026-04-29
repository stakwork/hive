"use client";

import { usePathname } from "next/navigation";

export type OrgView =
  | "canvas"
  | "canvas-demo"
  | "initiatives"
  | "workspaces"
  | "members"
  | "schematic"
  | "graph";

/**
 * Map the current pathname to a logical view id. Used by `OrgShell` to
 * decide what to render in the content slot and which icon in the
 * rail is active. The Connections doc list is no longer a route — it
 * lives as a tab inside the canvas's right panel.
 */
export function useOrgView(githubLogin: string): OrgView {
  const pathname = usePathname() ?? "";
  const base = `/org/${githubLogin}`;
  if (pathname === base || pathname === `${base}/`) return "canvas";
  if (pathname.startsWith(`${base}/canvas-demo`)) return "canvas-demo";
  if (pathname.startsWith(`${base}/initiatives`)) return "initiatives";
  if (pathname.startsWith(`${base}/workspaces`)) return "workspaces";
  if (pathname.startsWith(`${base}/members`)) return "members";
  if (pathname.startsWith(`${base}/schematic`)) return "schematic";
  if (pathname.startsWith(`${base}/graph`)) return "graph";
  return "canvas";
}

/** Views that fill the viewport (no scrollable max-w container). */
export function viewIsFullBleed(view: OrgView): boolean {
  return (
    view === "canvas" ||
    view === "canvas-demo" ||
    view === "schematic" ||
    view === "graph"
  );
}
