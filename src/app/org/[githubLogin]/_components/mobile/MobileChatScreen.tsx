"use client";

import React from "react";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { startNewOrgConversation } from "../../_state/openOrgConversation";
import { SidebarChat } from "../SidebarChat";
import { MobileArtifactsButton } from "./MobileArtifacts";
import { MobileChatActionsSheet } from "./MobileChatActionsSheet";
import { MobileTopBar, TOP_BAR_BUTTON } from "./MobileTopBar";

/** The chat's title as the list shows it; tapping it opens the chat's actions. */
function ChatTitleButton({ onClick }: { onClick: () => void }) {
  const title = useCanvasChatStore((s) =>
    s.activeConversationId ? s.conversations[s.activeConversationId]?.title : null,
  );
  return (
    <button
      type="button"
      data-testid="mobile-chat-title"
      aria-haspopup="dialog"
      onClick={onClick}
      className="h-12 min-w-0 max-w-full truncate rounded-lg px-2 text-left text-base font-semibold active:bg-muted"
    >
      {title || "New chat"}
    </button>
  );
}

function NewChatIconButton({ githubLogin }: { githubLogin: string }) {
  const hasMessages = useCanvasChatStore(
    (s) => ((s.activeConversationId ? s.conversations[s.activeConversationId]?.messages.length : 0) ?? 0) > 0,
  );
  return (
    <button
      type="button"
      data-testid="mobile-new-chat-button"
      aria-label="New chat"
      disabled={!hasMessages}
      onClick={() => startNewOrgConversation(githubLogin)}
      className={TOP_BAR_BUTTON}
    >
      <Plus className="h-5 w-5" />
    </button>
  );
}

/**
 * The chat, full screen: the top bar over the same `SidebarChat` the desktop
 * shows in its main column. Safe-area padding keeps the composer clear of the
 * home indicator; the shell keeps it above the keyboard.
 */
export function MobileChatScreen({
  githubLogin,
  chatReady,
  onBack,
}: {
  githubLogin: string;
  chatReady: boolean;
  /** Set when the chat is opened over another screen (the graph's Ask Jamie). */
  onBack?: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <MobileTopBar
        onBack={onBack}
        titleSlot={<ChatTitleButton onClick={() => setActionsOpen(true)} />}
        right={
          <>
            <MobileArtifactsButton />
            <NewChatIconButton githubLogin={githubLogin} />
          </>
        }
      />
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 pb-[env(safe-area-inset-bottom)]">
          {chatReady ? (
            <SidebarChat githubLogin={githubLogin} wide />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          )}
        </div>
      </div>
      <MobileChatActionsSheet githubLogin={githubLogin} open={actionsOpen} onOpenChange={setActionsOpen} />
    </div>
  );
}
