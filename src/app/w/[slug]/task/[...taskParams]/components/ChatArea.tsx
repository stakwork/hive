"use client";

import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Monitor, Server, ServerOff, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChatMessage as ChatMessageType, Option, Artifact, WorkflowStatus } from "@/lib/chat";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { getAgentIcon } from "@/lib/icons";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import TaskBreadcrumbs from "./TaskBreadcrumbs";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";
import { CollaboratorAvatars } from "@/components/whiteboard/CollaboratorAvatars";
import { InvitePopover } from "@/components/plan/InvitePopover";

interface ChatAreaProps {
  messages: ChatMessageType[];
  onSend: (message: string, attachments?: Array<{path: string, filename: string, mimeType: string, size: number}>) => Promise<void>;
  onArtifactAction: (messageId: string, action: Option, webhook: string) => Promise<void>;
  inputDisabled?: boolean;
  isLoading?: boolean;
  hasNonFormArtifacts?: boolean;
  isChainVisible?: boolean;
  lastLogLine?: string;
  logs?: LogEntry[];
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  pendingStepAttachment?: WorkflowTransition | null;
  onRemoveStepAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  taskTitle?: string | null;
  workspaceSlug?: string;
  showPreviewToggle?: boolean;
  showPreview?: boolean;
  onTogglePreview?: () => void;
  taskMode?: string;
  taskId?: string | null;
  podId?: string | null;
  onReleasePod?: () => Promise<void>;
  isReleasingPod?: boolean;
  featureId?: string | null;
  featureTitle?: string | null;
  collaborators?: CollaboratorInfo[];
  onOpenBountyRequest?: () => void;
  sphinxInviteEnabled?: boolean;
  onRetry?: () => Promise<void>;
  isRetrying?: boolean;
}

export function ChatArea({
  messages,
  onSend,
  onArtifactAction,
  inputDisabled = false,
  isLoading = false,
  isChainVisible = false,
  lastLogLine = "",
  logs = [],
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  pendingStepAttachment = null,
  onRemoveStepAttachment,
  workflowStatus,
  taskTitle,
  workspaceSlug,
  showPreviewToggle = false,
  showPreview = false,
  onTogglePreview,
  taskMode,
  taskId,
  podId,
  onReleasePod,
  isReleasingPod = false,
  featureId,
  featureTitle,
  collaborators,
  onOpenBountyRequest,
  sphinxInviteEnabled,
  onRetry,
  isRetrying = false,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const router = useRouter();
  const isMobile = useIsMobile();

  // Check if any message has a PULL_REQUEST artifact
  const hasPrArtifact = messages.some((msg) => msg.artifacts?.some((artifact) => artifact.type === "PULL_REQUEST"));

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider user at bottom if within 100px of bottom
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 80;
      setShouldAutoScroll(isNearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll only if user hasn't manually scrolled up
  useEffect(() => {
    if (!shouldAutoScroll) return;

    const scrollToBottom = () => {
      const ref = messagesEndRef.current;
      if (ref && typeof ref.scrollIntoView === "function") {
        ref.scrollIntoView({ behavior: "smooth" });
      }
    };

    // Use setTimeout for next tick; requestAnimationFrame is another option for smoother perf
    const timer = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(timer);
  }, [messages, shouldAutoScroll]);

  const handleBackToTasks = () => {
    const referrer = document.referrer;
    const currentOrigin = window.location.origin;

    // Check if referrer exists and is from same app (same origin)
    if (referrer && referrer.startsWith(currentOrigin)) {
      router.back();
    } else {
      // Fallback: feature Tasks tab for feature tasks, task list otherwise
      if (workspaceSlug) {
        const fallbackPath = featureId
          ? `/w/${workspaceSlug}/plan/${featureId}?tab=tasks`
          : `/w/${workspaceSlug}/tasks`;
        router.push(fallbackPath);
      } else {
        router.back();
      }
    }
  };

  return (
    <motion.div
      className={"flex h-full min-w-0 flex-col bg-background rounded-xl border shadow-sm overflow-hidden"}
      layout
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Task Title Header */}
      {taskTitle && (
        <div className="px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Back Button */}
              <Button variant="ghost" size="sm" onClick={handleBackToTasks} className="flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Button>

              {/* Task Title with inline breadcrumbs - with animation only when title changes */}
              <AnimatePresence mode="wait">
                <motion.h2
                  key={taskTitle} // This will trigger re-animation when title changes
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="text-lg font-semibold text-foreground flex-1 flex flex-col items-start gap-1 min-w-0"
                  title={taskTitle}
                  data-testid="task-title"
                >
                  {/* Inline Breadcrumbs - only show in task chat context */}
                  {workspaceSlug && taskId && (
                    <TaskBreadcrumbs
                      featureId={featureId ?? null}
                      featureTitle={featureTitle ?? null}
                      workspaceSlug={workspaceSlug}
                    />
                  )}
                  <span className="truncate w-full">
                    {taskTitle.length > 60 ? `${taskTitle.slice(0, 60)}...` : taskTitle}
                  </span>
                </motion.h2>
              </AnimatePresence>
            </div>

            {/* Presence Avatars */}
            {collaborators && collaborators.length > 0 && (
              <div className="flex-shrink-0 self-center">
                <CollaboratorAvatars collaborators={collaborators} />
              </div>
            )}

            {/* Invite Button (Plan Chat Only) */}
            {sphinxInviteEnabled && workspaceSlug && featureId && (
              <InvitePopover
                open={inviteOpen}
                onOpenChange={setInviteOpen}
                workspaceSlug={workspaceSlug}
                featureId={featureId}
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInviteOpen(true)}
                  className="flex-shrink-0 gap-2"
                  data-testid="invite-button"
                >
                  <UserPlus className="h-4 w-4" />
                  Invite
                </Button>
              </InvitePopover>
            )}

            {/* Preview Toggle Button (Mobile Only) */}
            {showPreviewToggle && onTogglePreview && (
              <Button
                variant={showPreview ? "default" : "ghost"}
                size="sm"
                onClick={onTogglePreview}
                className="flex-shrink-0"
                title={showPreview ? "Show Chat" : "Show Live Preview"}
              >
                <Monitor className="w-4 h-4" />
              </Button>
            )}

            {/* Pod Indicator with Release */}
            {podId && onReleasePod && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowReleaseConfirm(true)}
                      disabled={isReleasingPod}
                      className="flex-shrink-0 h-8 w-8 text-green-600 hover:text-amber-600 hover:bg-amber-50 transition-colors group"
                    >
                      <span className="relative w-4 h-4">
                        <Server className="w-4 h-4 transition-opacity duration-150 group-hover:opacity-0" data-testid="server-icon" />
                        <ServerOff className="w-4 h-4 absolute inset-0 transition-opacity duration-150 opacity-0 group-hover:opacity-100" />
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isReleasingPod ? "Releasing pod..." : "Release pod"}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className={cn("flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40", isMobile && "pb-28")}
      >
        {messages
          .filter((msg) => !msg.replyId) // Hide messages that are replies
          .map((msg) => {
            // Find if this message has been replied to
            const replyMessage = messages.find((m) => m.replyId === msg.id);

            return (
              <ChatMessage
                key={msg.id}
                message={msg}
                replyMessage={replyMessage}
                onArtifactAction={onArtifactAction}
              />
            );
          })}

        {isChainVisible && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex justify-start"
          >
            <div className="max-w-[85%] bg-muted rounded-2xl px-4 py-3 shadow-sm">
              <div className="font-medium text-sm text-muted-foreground mb-1 flex items-center gap-2">
                {getAgentIcon()}
                Hive
              </div>
              <div className="text-sm">{lastLogLine ? lastLogLine : `Communicating with workflow...`}</div>
              {/* Optional: Add a subtle loading indicator */}
              {isChainVisible && (
                <div className="flex items-center mt-2 text-xs text-muted-foreground">
                  <div className="flex space-x-1">
                    <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
                    <div
                      className="w-1 h-1 bg-current rounded-full animate-pulse"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                    <div
                      className="w-1 h-1 bg-current rounded-full animate-pulse"
                      style={{ animationDelay: "0.4s" }}
                    ></div>
                  </div>
                  <span className="ml-2">Processing...</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <ChatInput
        onSend={onSend}
        disabled={inputDisabled}
        isLoading={isLoading}
        pendingDebugAttachment={pendingDebugAttachment}
        onRemoveDebugAttachment={onRemoveDebugAttachment}
        pendingStepAttachment={pendingStepAttachment}
        onRemoveStepAttachment={onRemoveStepAttachment}
        workflowStatus={workflowStatus}
        hasPrArtifact={hasPrArtifact}
        taskMode={taskMode}
        taskId={taskId ?? undefined}
        featureId={featureId ?? undefined}
        workspaceSlug={workspaceSlug}
        onOpenBountyRequest={onOpenBountyRequest}
        onRetry={onRetry}
        isRetrying={isRetrying}
      />

      {onReleasePod && (
        <ConfirmDialog
          open={showReleaseConfirm}
          onOpenChange={setShowReleaseConfirm}
          title="Release Pod?"
          description="This will release the development pod back to the pool. Any unsaved work in the pod may be lost."
          confirmText="Release Pod"
          variant="destructive"
          onConfirm={onReleasePod}
          testId="release-pod-dialog"
        />
      )}
    </motion.div>
  );
}
