"use client";

import { InvitePopover } from "@/components/plan/InvitePopover";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CollaboratorAvatars } from "@/components/whiteboard/CollaboratorAvatars";
import { useIsMobile } from "@/hooks/useIsMobile";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import { Artifact, ChatMessage as ChatMessageType, ChatRole, Option, WorkflowStatus } from "@/lib/chat";
import { getAgentIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { WorkflowTransition } from "@/types/stakwork/workflow";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Monitor, Pencil, Server, ServerOff, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import TaskBreadcrumbs from "./TaskBreadcrumbs";

interface ChatAreaProps {
  messages: ChatMessageType[];
  onSend: (message: string, attachments?: Array<{ path: string, filename: string, mimeType: string, size: number }>) => Promise<void>;
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
  previewToggleIcon?: React.ComponentType<{ className?: string }>;
  taskMode?: string;
  taskId?: string | null;
  podId?: string | null;
  onReleasePod?: () => Promise<void>;
  isReleasingPod?: boolean;
  featureId?: string | null;
  featureTitle?: string | null;
  collaborators?: CollaboratorInfo[];
  onOpenBountyRequest?: () => void;
  isPlanComplete?: boolean;
  sphinxInviteEnabled?: boolean;
  isPlanChat?: boolean;
  onTitleSave?: (newTitle: string) => Promise<void>;
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
  previewToggleIcon: PreviewToggleIcon = Monitor,
  taskMode,
  taskId,
  podId,
  onReleasePod,
  isReleasingPod = false,
  featureId,
  featureTitle,
  collaborators,
  onOpenBountyRequest,
  isPlanComplete = false,
  sphinxInviteEnabled,
  isPlanChat = false,
  onTitleSave,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const isMobile = useIsMobile();

  // Check if any message has a PULL_REQUEST artifact
  const hasPrArtifact = messages.some((msg) => msg.artifacts?.some((artifact) => artifact.type === "PULL_REQUEST"));

  // Identify the last unanswered ASSISTANT message
  const lastUnansweredAssistantId = useMemo(() => {
    const assistantMsgs = messages.filter(
      (m) => !m.replyId && m.role === ChatRole.ASSISTANT
    );
    if (!assistantMsgs.length) return null;
    const last = assistantMsgs[assistantMsgs.length - 1];
    const hasReply = messages.some((m) => m.replyId === last.id);
    return hasReply ? null : last.id;
  }, [messages]);

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

  // Auto-focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleSaveInternal = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || !onTitleSave) {
      setIsEditingTitle(false);
      return;
    }
    await onTitleSave(trimmed);
    setIsEditingTitle(false);
  };

  const handleTitleEdit = () => {
    if (featureId && onTitleSave) {
      setTitleDraft(taskTitle ?? "");
      setIsEditingTitle(true);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleSaveInternal();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditingTitle(false);
    }
  };

  const handleBackToTasks = () => {
    if (isPlanChat) {
      router.push(`/w/${workspaceSlug}/plan`);
    } else if (workspaceSlug) {
      const path = featureId
        ? `/w/${workspaceSlug}/plan/${featureId}?tab=tasks`
        : `/w/${workspaceSlug}/tasks`;
      router.push(path);
    } else {
      router.back();
    }
  };

  return (
    <motion.div
      className={"flex h-full min-w-0 flex-col bg-background rounded-xl border shadow-sm overflow-hidden"}
      layout
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      data-testid="chat-area"
      data-is-plan-complete={isPlanComplete.toString()}
    >
      {/* Task Title Header */}
      {taskTitle && (
        <div className={cn("px-4 py-3 border-b bg-muted/20", isMobile && "fixed top-0 left-0 right-0 z-20 bg-background border-b")}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* Back Button */}
              <Button variant="ghost" size="sm" onClick={handleBackToTasks} className="flex-shrink-0">
                <ArrowLeft className="w-4 h-4" />
              </Button>

              {/* Task Title with inline breadcrumbs - with animation only when title changes */}
              {!isEditingTitle ? (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={taskTitle}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="text-lg font-semibold text-foreground flex-1 flex flex-col items-start gap-1 min-w-0 group"
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
                    <div className="flex items-center gap-2 w-full min-w-0">
                      <span
                        className="truncate cursor-pointer"
                        title={taskTitle}
                        onClick={handleTitleEdit}
                      >
                        {taskTitle && taskTitle.length > 60 ? `${taskTitle.slice(0, 60)}...` : taskTitle}
                      </span>
                      {featureId && onTitleSave && (
                        <Pencil
                          className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex-shrink-0"
                          onClick={handleTitleEdit}
                        />
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              ) : (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleSaveInternal}
                  onKeyDown={handleTitleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="text-lg font-semibold text-foreground flex-1 bg-background border border-primary rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
                  data-testid="task-title-input"
                />
              )}
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
                title={showPreview ? "Show Chat" : "Show Preview"}
              >
                <PreviewToggleIcon className="w-4 h-4" />
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
        className={cn("flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40", isMobile && "pb-28", isMobile && taskTitle && "pt-16")}
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
                isLatestAwaitingReply={msg.id === lastUnansweredAssistantId && !inputDisabled}
                isPlanComplete={isPlanComplete}
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
