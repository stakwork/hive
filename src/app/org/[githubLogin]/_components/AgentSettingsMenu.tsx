"use client";

import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutomationsSection } from "./AutomationsSection";
import { readSlimPromptPreference, writeSlimPromptPreference } from "../_state/slimPromptPreference";

/**
 * The "Agent settings" group of the chat header's ⋯ menu:
 *
 *   - **Concept-tree prompt** — experimental, per-browser (localStorage,
 *     see `slimPromptPreference.ts`): the canvas agent gets the shorter
 *     capability sections and relies on the concept tree for how-to
 *     detail. Off = the full sections. Toggling keeps the menu open.
 *   - **Automations…** — opens `AutomationsDialog` (the list and add form
 *     are too big for a menu).
 *
 * Render inside a `DropdownMenuContent`; the dialog is mounted by the caller
 * outside the menu so it outlives the menu closing.
 */
export function AgentSettingsMenuItems({ onOpenAutomations }: { onOpenAutomations: () => void }) {
  const [slimPrompt, setSlimPrompt] = useState(false);

  useEffect(() => {
    setSlimPrompt(readSlimPromptPreference());
  }, []);

  const handleSlimToggle = (next: boolean) => {
    setSlimPrompt(next);
    writeSlimPromptPreference(next);
  };

  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Agent settings</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={slimPrompt}
        onCheckedChange={handleSlimToggle}
        // Keep the menu open so the toggle reads as a switch, not an action.
        onSelect={(e) => e.preventDefault()}
        title="Experimental, this browser only. Use shorter capability sections and rely on the concept tree for detail."
      >
        Concept-tree prompt
      </DropdownMenuCheckboxItem>
      <DropdownMenuItem onSelect={onOpenAutomations}>
        <Clock className="w-4 h-4" />
        Automations…
      </DropdownMenuItem>
    </>
  );
}

/** The existing automations manager, in a dialog. Behaviour is `AutomationsSection`'s own. */
export function AutomationsDialog({
  githubLogin,
  open,
  onOpenChange,
}: {
  githubLogin: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Automations</DialogTitle>
        </DialogHeader>
        <AutomationsSection githubLogin={githubLogin} />
      </DialogContent>
    </Dialog>
  );
}
