"use client";

import React from "react";
import { Home, ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  ref_id: string;
  name: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
}

export function LingoBreadcrumb({ items, onNavigate }: BreadcrumbProps) {
  return (
    <nav
      aria-label="breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap"
      data-testid="lingo-breadcrumb"
    >
      <button
        onClick={() => onNavigate(-1)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        data-testid="breadcrumb-home"
      >
        <Home className="w-3.5 h-3.5" />
        <span>Home</span>
      </button>

      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={item.ref_id}>
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            {isLast ? (
              <span
                className="font-semibold text-foreground truncate max-w-[180px]"
                data-testid={`breadcrumb-item-${index}`}
                title={item.name}
              >
                {item.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(index)}
                className="hover:text-foreground transition-colors truncate max-w-[180px]"
                data-testid={`breadcrumb-item-${index}`}
                title={item.name}
              >
                {item.name}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
