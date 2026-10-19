"use client";

import React from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { OrgCanvasBackground } from "../../connections/OrgCanvasBackground";
import type { HiddenLiveEntry } from "../../connections/HiddenLivePill";
import { canvasTab } from "../useOrgView";
import { MobileInitiativesList } from "./MobileInitiativesList";
import { MobileTopBar } from "./MobileTopBar";

type MobileCanvasTab = "map" | "initiatives";
const TABS: { key: MobileCanvasTab; label: string }[] = [
  { key: "map", label: "Map" },
  { key: "initiatives", label: "Initiatives" },
];

/**
 * The canvas view on a phone, view only: the map — pan and look, nothing to
 * edit, drag or create — and the initiatives as a list. No brainstorm desk
 * (`?tab=brainstorm` shows the map). The tab follows `?tab=` as on desktop.
 */
export function MobileCanvasView({
  githubLogin,
  orgName,
  onHiddenChange,
}: {
  githubLogin: string;
  orgName: string | null;
  onHiddenChange: (entries: HiddenLiveEntry[]) => void;
}) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<MobileCanvasTab>(() => (canvasTab(searchParams) === "initiatives" ? "initiatives" : "map"));

  const select = (next: MobileCanvasTab) => {
    setTab(next);
    // `replaceState`, not the router: a navigation re-runs the page's server work.
    const params = new URLSearchParams(window.location.search);
    params.set("view", "canvas");
    if (next === "map") params.delete("tab");
    else params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mobile-canvas-view">
      <MobileTopBar title="Canvas" />
      <div role="tablist" aria-label="Canvas view" className="flex shrink-0 border-b px-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => select(key)}
            className={cn(
              "-mb-px flex h-11 flex-1 items-center justify-center border-b-2 text-[15px] font-medium transition-colors",
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {tab === "map" ? (
          <div className="absolute inset-0 isolate overflow-hidden">
            <OrgCanvasBackground readOnly githubLogin={githubLogin} orgName={orgName} onHiddenChange={onHiddenChange} />
          </div>
        ) : (
          <div className="absolute inset-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <MobileInitiativesList githubLogin={githubLogin} />
          </div>
        )}
      </div>
    </div>
  );
}
