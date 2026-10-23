"use client";

import React from "react";
import { Clock } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutomationsSection } from "./AutomationsSection";

/**
 * The agent-settings rows of the chat header's ⋯ menu, after Fork:
 *
 *   - **Automations** — opens `AutomationsDialog` (the list and add form
 *     are too big for a menu).
 *
 * Jamie runs on the swarm strut's `orchestrator` workflow
 * (`docs/jamie-engine.md`), so the menu holds no engine or prompt switch.
 *
 * Render inside a `DropdownMenuContent`; the dialog is mounted by the caller
 * outside the menu so it outlives the menu closing.
 */
export function AgentSettingsMenuItems({ onOpenAutomations }: { onOpenAutomations: () => void }) {
  return (
    <DropdownMenuItem onSelect={onOpenAutomations}>
      <Clock className="w-4 h-4" />
      Automations
    </DropdownMenuItem>
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
