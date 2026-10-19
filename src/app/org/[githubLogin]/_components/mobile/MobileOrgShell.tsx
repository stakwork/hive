"use client";

import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useControlPanel } from "../control-panel/useControlPanel";
import { useOrgView, type OrgView } from "../useOrgView";
import { MobileOrgContext } from "./MobileOrgContext";
import { MobileOrgDrawer } from "./MobileOrgDrawer";
import { MobileTopBar } from "./MobileTopBar";
import { useVisualViewportHeight } from "./useVisualViewportHeight";

interface MobileOrgShellProps {
  githubLogin: string;
  orgName: string | null;
  avatarUrl: string | null;
  user: { name: string; email: string; avatar: string };
  children: React.ReactNode;
}

const ROUTE_TITLE: Partial<Record<OrgView, string>> = {
  strut: "Strut",
  ops: "Ops",
  settings: "Settings",
  "canvas-demo": "Canvas",
};

/** How far right a swipe from the left edge must travel to open the drawer. */
const EDGE_SWIPE_PX = 48;

/**
 * The org page's chrome on a phone, in place of the rail: one full-screen
 * column (`dvh`, trimmed to the visual viewport while the keyboard is up) and
 * the navigation drawer, opened by the menu button or a swipe from the left
 * edge. The org page's own views (chats, canvas, graph) draw their top bar;
 * the other routes beneath the org (Strut, Settings…) get a plain one here.
 */
export function MobileOrgShell({ githubLogin, orgName, avatarUrl, user, children }: MobileOrgShellProps) {
  const view = useOrgView(githubLogin);
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const viewportHeight = useVisualViewportHeight();
  const chatList = useControlPanel(githubLogin);
  const displayName = orgName ?? githubLogin;

  const base = `/org/${githubLogin}`;
  const onOrgPage = pathname === base || pathname === `${base}/`;

  // Navigating closes the drawer.
  const location = `${pathname}?${searchParams?.toString() ?? ""}`;
  useEffect(() => setDrawerOpen(false), [location]);

  const context = useMemo(() => ({ openDrawer: () => setDrawerOpen(true), chatList }), [chatList]);

  const swipe = useRef<{ x: number; y: number } | null>(null);

  return (
    <MobileOrgContext.Provider value={context}>
      <div
        data-testid="mobile-org-shell"
        className={cn("relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground")}
        style={viewportHeight ? { height: viewportHeight } : undefined}
      >
        {!onOrgPage && <MobileTopBar title={ROUTE_TITLE[view] ?? displayName} />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>

        {/* A strip along the left edge: dragging right from it opens the drawer. */}
        {!drawerOpen && (
          <div
            aria-hidden
            data-testid="mobile-edge-swipe"
            className="fixed inset-y-0 left-0 z-30 w-3"
            onTouchStart={(e) => {
              const t = e.touches[0];
              swipe.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchMove={(e) => {
              const start = swipe.current;
              if (!start) return;
              const t = e.touches[0];
              if (t.clientX - start.x > EDGE_SWIPE_PX && Math.abs(t.clientY - start.y) < EDGE_SWIPE_PX) {
                swipe.current = null;
                setDrawerOpen(true);
              }
            }}
            onTouchEnd={() => (swipe.current = null)}
            onTouchCancel={() => (swipe.current = null)}
          />
        )}

        <MobileOrgDrawer
          githubLogin={githubLogin}
          list={chatList}
          org={{ name: displayName, avatarUrl }}
          user={user}
          activeView={onOrgPage ? view : view === "canvas" ? "settings" : view}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      </div>
    </MobileOrgContext.Provider>
  );
}
