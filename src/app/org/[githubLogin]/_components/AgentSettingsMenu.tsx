"use client";

import React, { useEffect, useState } from "react";
import { Clock, ListTree } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutomationsSection } from "./AutomationsSection";
import { readSlimPromptPreference, writeSlimPromptPreference } from "../_state/slimPromptPreference";

/**
 * The agent-settings rows of the chat header's ⋯ menu, after Fork:
 *
 *   - **Concept-tree prompt** — experimental, per-browser (localStorage,
 *     see `slimPromptPreference.ts`): the canvas agent gets the shorter
 *     capability sections and relies on the concept tree for how-to
 *     detail. Off = the full sections. Toggling keeps the menu open.
 *   - **Automations** — opens `AutomationsDialog` (the list and add form
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
      <DropdownMenuItem
        role="menuitemcheckbox"
        aria-checked={slimPrompt}
        // Keep the menu open so the toggle reads as a switch, not an action.
        onSelect={(e) => {
          e.preventDefault();
          handleSlimToggle(!slimPrompt);
        }}
        title="Experimental, this browser only. Use shorter capability sections and rely on the concept tree for detail."
      >
        <ListTree className="w-4 h-4" />
        Concept-tree prompt
        <Switch
          checked={slimPrompt}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none ml-auto scale-75"
        />
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onOpenAutomations}>
        <Clock className="w-4 h-4" />
        Automations
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
