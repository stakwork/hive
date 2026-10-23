"use client";

import React from "react";

import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { MentionWorkspace } from "@/hooks/useWorkspaceMention";

interface MentionPopupProps {
  workspaces: MentionWorkspace[];
  activeIndex: number;
  onSelect: (slug: string) => void;
}

/** Popup anchored above its `relative` parent, listing @mention workspace matches. */
export function MentionPopup({ workspaces, activeIndex, onSelect }: MentionPopupProps) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-20" data-testid="mention-popup">
      <Command className="rounded-lg border shadow-md bg-popover" shouldFilter={false}>
        <CommandList>
          {workspaces.map((ws, idx) => (
            <CommandItem
              key={ws.slug}
              value={ws.slug}
              onSelect={() => onSelect(ws.slug)}
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                idx === activeIndex && "bg-accent text-accent-foreground",
              )}
              data-testid={`mention-item-${ws.slug}`}
            >
              <span className="font-medium">@{ws.slug}</span>
              {ws.name && ws.name !== ws.slug && (
                <span className="ml-2 text-muted-foreground">{ws.name}</span>
              )}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}
