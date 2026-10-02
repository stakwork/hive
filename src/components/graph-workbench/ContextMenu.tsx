"use client";

import React, { useCallback, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MenuItem {
  label: string;
  onSelect: () => void;
  hint?: string;
  separatorBefore?: boolean;
}

/**
 * A right-click menu that opens at the pointer. There's no Radix context-menu
 * primitive installed, so a controlled dropdown anchors to a 1px trigger
 * placed where the click landed. Render `menu` outside any transformed
 * ancestor (the canvas viewport), or `position: fixed` resolves against it.
 */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; title?: string; items: MenuItem[] } | null>(null);

  const open = useCallback((e: React.MouseEvent | MouseEvent, items: MenuItem[], title?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items, title });
  }, []);

  const menu = (
    <DropdownMenu open={!!state} onOpenChange={(o) => !o && setState(null)} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed h-px w-px"
          style={{ left: state?.x ?? 0, top: state?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="w-56" data-testid="graph-workbench-context-menu">
        {state?.title && (
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            {state.title}
          </DropdownMenuLabel>
        )}
        {state?.items.map((item) => (
          <React.Fragment key={item.label}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={item.onSelect}>
              {item.label}
              {item.hint && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{item.hint}</span>}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return { open, menu };
}
