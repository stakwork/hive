"use client";

import React from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileOrg } from "./MobileOrgContext";

export const TOP_BAR_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors active:bg-muted disabled:opacity-40";

interface MobileTopBarProps {
  /** The screen's title; `titleSlot` replaces it (the chat's tappable title). */
  title?: string;
  titleSlot?: ReactNode;
  /** With this the menu button becomes a back button (a screen opened over another). */
  onBack?: () => void;
  right?: ReactNode;
  className?: string;
}

/**
 * The bar every mobile org screen wears: the menu (or back) button, the title,
 * and the screen's own actions. Touch-sized, and clear of the notch.
 */
export function MobileTopBar({ title, titleSlot, onBack, right, className }: MobileTopBarProps) {
  const { openDrawer } = useMobileOrg();
  return (
    <header
      data-testid="mobile-org-topbar"
      className={cn(
        "flex shrink-0 items-center gap-1 border-b bg-background px-1 pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      {onBack ? (
        <button type="button" aria-label="Back" data-testid="mobile-back-button" onClick={onBack} className={TOP_BAR_BUTTON}>
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Open menu"
          data-testid="mobile-menu-button"
          onClick={openDrawer}
          className={TOP_BAR_BUTTON}
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <div className="flex h-12 min-w-0 flex-1 items-center">
        {titleSlot ?? <h1 className="truncate px-1 text-base font-semibold">{title}</h1>}
      </div>
      {right && <div className="flex shrink-0 items-center">{right}</div>}
    </header>
  );
}
