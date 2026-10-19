"use client";

import React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { Archive, Clock, ListTree, Share2, Split } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { AutomationsDialog } from "../AgentSettingsMenu";
import { useChatShareFork } from "../SidebarChat";
import { startNewOrgConversation } from "../../_state/openOrgConversation";
import { useMobileOrg } from "./MobileOrgContext";
import { readSlimPromptPreference, writeSlimPromptPreference } from "../../_state/slimPromptPreference";

const ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base transition-colors active:bg-muted disabled:opacity-40";

function Row({
  icon,
  children,
  trailing,
  ...props
}: {
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={cn(ROW, props.className)}>
      <span className="text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <span className="flex-1">{children}</span>
      {trailing}
    </button>
  );
}

interface MobileChatActionsSheetProps {
  githubLogin: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * What the desktop header's Share and ⋯ menu do, as a bottom sheet: Share,
 * Fork, and the agent settings. The handlers are the desktop's own
 * (`useChatShareFork`, the slim-prompt preference, `AutomationsDialog`).
 */
export function MobileChatActionsSheet({ githubLogin, open, onOpenChange }: MobileChatActionsSheetProps) {
  const { serverConversationId, isStreaming, isForking, handleShare, handleFork } = useChatShareFork(githubLogin);
  const { chatList } = useMobileOrg();
  // The list's row for this chat — what the desktop list's archive acts on.
  const activeItem = chatList?.groups
    .flatMap((group) => group.items)
    .find((item) => item.id === serverConversationId);
  const [slimPrompt, setSlimPrompt] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);

  useEffect(() => {
    if (open) setSlimPrompt(readSlimPromptPreference());
  }, [open]);

  const toggleSlimPrompt = () => {
    const next = !slimPrompt;
    setSlimPrompt(next);
    writeSlimPromptPreference(next);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          data-testid="mobile-chat-actions-sheet"
          className="max-h-[85dvh] gap-0 rounded-t-2xl px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="px-3 pb-2">
            <SheetTitle>Chat</SheetTitle>
            <SheetDescription className="sr-only">Share, fork or configure this chat</SheetDescription>
          </SheetHeader>
          <Row
            icon={<Share2 />}
            disabled={!serverConversationId}
            onClick={() => {
              onOpenChange(false);
              void handleShare();
            }}
          >
            Share link
          </Row>
          <Row
            icon={<Split />}
            disabled={!serverConversationId || isStreaming || isForking}
            onClick={() => {
              onOpenChange(false);
              void handleFork();
            }}
          >
            Fork into my copy
          </Row>
          <Row
            icon={<Archive />}
            disabled={!activeItem || isStreaming}
            onClick={() => {
              if (!activeItem || !chatList) return;
              onOpenChange(false);
              chatList.onArchive(activeItem);
              startNewOrgConversation(githubLogin);
            }}
          >
            Archive chat
          </Row>
          <p className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Agent settings
          </p>
          {/* The whole row toggles; the switch is the control a screen reader gets. */}
          <div className={ROW} onClick={toggleSlimPrompt}>
            <span className="text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
              <ListTree />
            </span>
            <span className="flex-1">Concept-tree prompt</span>
            <Switch
              checked={slimPrompt}
              aria-label="Concept-tree prompt"
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={(next) => {
                setSlimPrompt(next);
                writeSlimPromptPreference(next);
              }}
            />
          </div>
          <Row
            icon={<Clock />}
            onClick={() => {
              onOpenChange(false);
              setAutomationsOpen(true);
            }}
          >
            Automations
          </Row>
        </SheetContent>
      </Sheet>
      <AutomationsDialog githubLogin={githubLogin} open={automationsOpen} onOpenChange={setAutomationsOpen} />
    </>
  );
}
