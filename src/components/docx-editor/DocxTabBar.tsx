"use client";
import React from "react";

import { useRef, useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight, GitCompare, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DocxTab {
  id: string;
  label: string;
  /** "document" = editable, "compare" = read-only compare, "blackline" = read-only blackline */
  kind: "document" | "compare" | "blackline";
}

interface DocxTabBarProps {
  tabs: DocxTab[];
  activeId: string;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
}

const SCROLL_STEP = 160; // px per arrow click

export default function DocxTabBar({
  tabs,
  activeId,
  onTabChange,
  onTabClose,
}: DocxTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Observe size changes so arrows appear/disappear dynamically
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollState();

    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    el.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateScrollState);
    };
  }, [updateScrollState, tabs.length]);

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" });
  };

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: SCROLL_STEP, behavior: "smooth" });
  };

  // Scroll active tab into view when it changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeEl = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeId]);

  const tabIcon = (kind: DocxTab["kind"]) => {
    if (kind === "compare") return <GitCompare className="size-3 shrink-0 mr-1" />;
    if (kind === "blackline") return <GitCompare className="size-3 shrink-0 mr-1 text-amber-500" />;
    return <FileText className="size-3 shrink-0 mr-1" />;
  };

  return (
    <div
      className="flex items-center border-b bg-muted/40 flex-none h-9"
      role="tablist"
      aria-label="Open documents"
    >
      {/* Left arrow — only visible when scrollable */}
      <button
        data-testid="tab-scroll-left"
        onClick={scrollLeft}
        aria-label="Scroll tabs left"
        className={cn(
          "flex items-center justify-center h-full w-7 shrink-0 hover:bg-muted transition-colors border-r",
          !canScrollLeft && "invisible pointer-events-none"
        )}
      >
        <ChevronLeft className="size-3.5" />
      </button>

      {/* Scrollable tab strip */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none min-w-0"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isVirtual = tab.kind !== "document";

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              role="tab"
              aria-selected={isActive}
              className={cn(
                "flex items-center gap-0.5 px-3 h-full text-sm whitespace-nowrap border-r cursor-pointer select-none shrink-0 group transition-colors",
                isActive
                  ? "bg-background text-foreground border-t-2 border-t-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground border-t-2 border-t-transparent"
              )}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onTabChange(tab.id);
              }}
              tabIndex={0}
            >
              {tabIcon(tab.kind)}
              <span className="max-w-[140px] truncate text-xs font-medium">
                {tab.label}
              </span>
              {isVirtual && (
                <span className="ml-1 text-[10px] text-muted-foreground bg-muted rounded px-1">
                  RO
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                aria-label={`Close ${tab.label}`}
                className={cn(
                  "ml-1 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted-foreground/20",
                  isActive && "opacity-60"
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Right arrow — only visible when scrollable */}
      <button
        data-testid="tab-scroll-right"
        onClick={scrollRight}
        aria-label="Scroll tabs right"
        className={cn(
          "flex items-center justify-center h-full w-7 shrink-0 hover:bg-muted transition-colors border-l",
          !canScrollRight && "invisible pointer-events-none"
        )}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
