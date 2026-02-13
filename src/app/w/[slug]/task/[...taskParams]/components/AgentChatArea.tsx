"use client";

import React, { useEffect, useRef, useState } from "react";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useIsMobile";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";
import type { Artifact, ChatMessage, WorkflowStatus } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronDown, ExternalLink, Github, GitCommit, Monitor, Server, ServerOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { AgentChatMessage } from "./AgentChatMessage";
import { ChatInput } from "./ChatInput";
import TaskBreadcrumbs from "./TaskBreadcrumbs";

interface AgentChatAreaProps {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  inputDisabled?: boolean;
  isLoading?: boolean;
  logs?: LogEntry[];
  pendingDebugAttachment?: Artifact | null;
  onRemoveDebugAttachment?: () => void;
  workflowStatus?: WorkflowStatus | null;
  taskTitle?: string | null;
  workspaceSlug?: string;
  onCommit?: () => Promise<void>;
  isCommitting?: boolean;
  showPreviewToggle?: boolean;
  showPreview?: boolean;
  onTogglePreview?: () => void;
  taskMode?: string;
  podId?: string | null;
  onReleasePod?: () => Promise<void>;
  isReleasingPod?: boolean;
  prUrl?: string | null;
  featureId?: string | null;
  featureTitle?: string | null;
  onOpenBountyRequest?: () => void;
}

export function AgentChatArea({
  messages,
  onSend,
  inputDisabled = false,
  isLoading = false,
  logs = [],
  pendingDebugAttachment = null,
  onRemoveDebugAttachment,
  workflowStatus,
  taskTitle,
  workspaceSlug,
  onCommit,
  isCommitting = false,
  showPreviewToggle = false,
  showPreview = false,
  onTogglePreview,
  taskMode,
  podId,
  onReleasePod,
  isReleasingPod = false,
  prUrl = null,
  featureId,
  featureTitle,
  onOpenBountyRequest,
}: AgentChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const router = useRouter();
  const isMobile = useIsMobile();

  // Check if any message has a PULL_REQUEST artifact
  const hasPrArtifact = messages.some((msg) =>
    msg.artifacts?.some((artifact) => artifact.type === "PULL_REQUEST")
  );

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

    const timer = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(timer);
  }, [messages, shouldAutoScroll]);

  const handleBackToTasks = () => {
    // Check for 'from' URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const fromParam = urlParams.get('from');

    console.log('fromParam', fromParam);

    if (fromParam) {
      // Navigate to the specific route provided in 'from' parameter
      router.push(fromParam);
    } else {
      // Fallback to tasks list
      if (workspaceSlug) {
        router.push(`/w/${workspaceSlug}/tasks`);
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
      <AnimatePresence mode="wait">
        {taskTitle && (
          <motion.div
            key="title-header"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-3 border-b bg-muted/20"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Button variant="ghost" size="sm" onClick={handleBackToTasks} className="flex-shrink-0 mt-0.5">
                  <ArrowLeft className="w-4 h-4" />
                </Button>

                <AnimatePresence mode="wait">
                  <motion.h2
                    key={taskTitle}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="text-lg font-semibold text-foreground flex-1 flex flex-col items-start gap-1 min-w-0"
                    title={taskTitle}
                    data-testid="task-title"
                  >
                    {/* Inline Breadcrumbs */}
                    {workspaceSlug && (
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

              {/* Create PR / Open PR Dropdown */}
              {onCommit && (
                prUrl ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        className="flex-shrink-0 gap-1 text-white hover:opacity-90"
                        style={{ backgroundColor: "#238636" }}
                      >
                        <Github className="w-3 h-3" />
                        PR Actions
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => window.open(prUrl, '_blank')}>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open PR
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={onCommit} disabled={isCommitting}>
                        <GitCommit className="w-4 h-4 mr-2" />
                        {isCommitting ? "Pushing..." : "Push New Commit"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    size="sm"
                    onClick={onCommit}
                    disabled={isCommitting}
                    className="flex-shrink-0 gap-1 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Github className="w-3 h-3" />
                    {isCommitting ? "Creating..." : "Create PR"}
                  </Button>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div ref={messagesContainerRef} className={cn(
        "flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40",
        isMobile && "pb-28"
      )}>
        {messages.map((msg) => (
          <AgentChatMessage key={msg.id} message={msg} />
        ))}

        {/* Show thinking indicator when loading but no assistant message streaming yet */}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role === "USER" && (
          <motion.div
            className="space-y-3 relative"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-end gap-3 justify-start">
              <div className="px-4 py-1 rounded-md max-w-full shadow-sm relative bg-background text-foreground rounded-bl-md border">
                <ThinkingIndicator />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <ChatInput
        logs={logs}
        onSend={onSend}
        disabled={inputDisabled}
        isLoading={isLoading}
        pendingDebugAttachment={pendingDebugAttachment}
        onRemoveDebugAttachment={onRemoveDebugAttachment}
        workflowStatus={workflowStatus}
        hasPrArtifact={hasPrArtifact}
        taskMode={taskMode}
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
