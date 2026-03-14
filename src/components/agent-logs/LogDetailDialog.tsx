"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, User, Bot, Wrench, Code2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import type { ParsedMessage, ToolCallContent, ToolResultContent, AgentLogStats } from "@/lib/utils/agent-log-stats";

interface LogDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logId: string | null;
}

function extractTextContent(message: ParsedMessage): string | null {
  const { content, reasoning } = message;

  if (typeof content === "string" && content) return content;

  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (part): part is { type: string; text?: string } =>
          part != null && typeof part === "object" && "text" in part && part.type === "text",
      )
      .map((p) => p.text)
      .filter(Boolean);

    if (textParts.length > 0) return textParts.join("\n");
  }

  // Fall back to reasoning field (used by some agent formats)
  if (typeof reasoning === "string" && reasoning) return reasoning;

  return null;
}

function extractToolCalls(
  content: ParsedMessage["content"],
): ToolCallContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is ToolCallContent =>
      part != null && typeof part === "object" && part.type === "tool-call",
  );
}

function extractToolResults(
  content: ParsedMessage["content"],
): ToolResultContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is ToolResultContent =>
      part != null && typeof part === "object" && part.type === "tool-result",
  );
}

function getToolResultValue(output: ToolResultContent["output"]): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "value" in output) {
    const val = output.value;
    if (typeof val === "string") {
      // Truncate very long outputs
      return val.length > 2000 ? val.slice(0, 2000) + "\n... (truncated)" : val;
    }
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function MessageBubble({ message }: { message: ParsedMessage }) {
  const [showToolDetails, setShowToolDetails] = useState(false);

  // Defensive: skip if message is somehow not a valid object
  if (!message || typeof message !== "object" || typeof message.role !== "string") {
    return null;
  }

  const { role, content } = message;
  const textContent = extractTextContent(message);
  const toolCalls = extractToolCalls(content);
  const toolResults = extractToolResults(content);
  const openaiToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  const isUser = role === "user";
  const isTool = role === "tool";
  const isAssistant = role === "assistant";

  // All tool call names (Vercel AI SDK style + OpenAI style)
  const allToolCallNames = [
    ...toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName })),
    ...openaiToolCalls
      .filter((tc) => tc && typeof tc === "object" && tc.function?.name)
      .map((tc) => ({ id: tc.id, name: tc.function.name })),
  ];

  // Tool-only messages (no text content)
  if (isAssistant && !textContent && allToolCallNames.length > 0) {
    return (
      <div className="flex gap-2 items-start">
        <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
          <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {allToolCallNames.map((tc, i) => (
            <div
              key={tc.id || i}
              className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 font-mono break-words"
            >
              Called <span className="font-semibold">{tc.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Tool result messages (Vercel AI SDK style)
  if (isTool && toolResults.length > 0) {
    return (
      <div className="flex gap-2 items-start">
        <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
          <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setShowToolDetails(!showToolDetails)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {toolResults.length} tool result{toolResults.length > 1 ? "s" : ""}{" "}
            {showToolDetails ? "(hide)" : "(show)"}
          </button>
          {showToolDetails && (
            <div className="mt-1 space-y-1">
              {toolResults.map((tr, i) => (
                <pre
                  key={tr.toolCallId || i}
                  className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all"
                >
                  {getToolResultValue(tr.output)}
                </pre>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tool result messages (OpenAI style: role=tool with tool_call_id + string content)
  if (isTool && message.tool_call_id && typeof content === "string") {
    const truncated = content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content;
    return (
      <div className="flex gap-2 items-start">
        <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
          <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setShowToolDetails(!showToolDetails)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            1 tool result {showToolDetails ? "(hide)" : "(show)"}
          </button>
          {showToolDetails && (
            <pre className="mt-1 text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
              {truncated}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // Skip messages with no displayable content
  if (!textContent) return null;

  return (
    <div className={cn("flex gap-2 items-start", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center",
          isUser ? "bg-primary" : "bg-muted",
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-primary-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[90%] rounded-lg px-3 py-2",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted/50 border",
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap break-words">
            {textContent}
          </p>
        ) : (
          <MarkdownRenderer variant="assistant" size="compact">
            {textContent}
          </MarkdownRenderer>
        )}
        {/* Inline tool calls in assistant messages with text */}
        {isAssistant && allToolCallNames.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
            {allToolCallNames.map((tc, i) => (
              <div
                key={tc.id || i}
                className="text-xs text-muted-foreground font-mono break-words"
              >
                Called <span className="font-semibold">{tc.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatsBar({ stats }: { stats: AgentLogStats }) {
  const [showBash, setShowBash] = useState(false);

  const hasToolCalls = stats.totalToolCalls > 0;
  const sortedTools = hasToolCalls
    ? Object.entries(stats.toolFrequency).sort((a, b) => b[1] - a[1])
    : [];
  const hasBashFrequency = Object.keys(stats.bashFrequency ?? {}).length > 0;
  const sortedBash = hasBashFrequency
    ? Object.entries(stats.bashFrequency).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 space-y-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{stats.totalMessages}</span> messages
        {" · "}
        ~<span className="font-medium text-foreground">{stats.estimatedTokens.toLocaleString()}</span> tokens
        {" · "}
        <span className="font-medium text-foreground">{stats.totalToolCalls}</span> tool call{stats.totalToolCalls !== 1 ? "s" : ""}
      </p>
      {hasToolCalls && (
        <div className="flex flex-wrap gap-1.5">
          {sortedTools.map(([name, count]) =>
            name === "bash" && hasBashFrequency ? (
              <button
                key={name}
                onClick={() => setShowBash((s) => !s)}
                className="inline-flex items-center"
              >
                <Badge
                  variant="secondary"
                  className="text-xs font-mono px-1.5 py-0 brightness-125 cursor-pointer hover:brightness-150 transition-[filter]"
                >
                  {name} ×{count}
                </Badge>
              </button>
            ) : (
              <Badge key={name} variant="secondary" className="text-xs font-mono px-1.5 py-0">
                {name} ×{count}
              </Badge>
            )
          )}
        </div>
      )}
      {showBash && hasBashFrequency && (
        <div className="flex flex-wrap gap-1.5 pl-2 border-l-2 border-muted-foreground/30">
          {sortedBash.map(([cmd, count]) => (
            <Badge key={cmd} variant="outline" className="text-xs font-mono px-1.5 py-0">
              {cmd} ×{count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function LogDetailDialog({
  open,
  onOpenChange,
  logId,
}: LogDetailDialogProps) {
  const [conversation, setConversation] = useState<ParsedMessage[] | null>(null);
  const [stats, setStats] = useState<AgentLogStats | null>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !logId) {
      setConversation(null);
      setStats(null);
      setRawContent("");
      setError(null);
      return;
    }

    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/agent-logs/${logId}/stats`);
        if (!response.ok) {
          throw new Error(`Failed to fetch log: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.conversation && Array.isArray(data.conversation) && data.conversation.length > 0) {
          setConversation(data.conversation);
          setStats(data.stats ?? null);
        } else {
          // Fallback: store raw JSON for display
          setRawContent(JSON.stringify(data, null, 2));
        }
      } catch (err) {
        console.error("Error fetching log stats:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch log content",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [open, logId]);

  const hasContent = conversation !== null || rawContent !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Agent Log Details</DialogTitle>
          <DialogDescription>
            {logId ? `Log ID: ${logId}` : "Viewing agent log content"}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 min-h-0 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && hasContent && (
            <>
              {stats && <StatsBar stats={stats} />}
              <ScrollArea className="h-[400px] w-full rounded-md border [&_[data-radix-scroll-area-viewport]>div]:!block">
                {conversation ? (
                  <div className="p-4 space-y-3">
                    {conversation.map((msg, i) => (
                      <MessageBubble key={i} message={msg} />
                    ))}
                  </div>
                ) : (
                  <pre className="p-4 whitespace-pre-wrap break-words font-mono text-sm">
                    {rawContent}
                  </pre>
                )}
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              toast.success("Link copied to clipboard!");
            }}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
