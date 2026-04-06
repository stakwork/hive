"use client";

import React, { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, User, Bot, Wrench, Code2 } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import type {
  ParsedMessage,
  ToolCallContent,
  ToolResultContent,
  AgentLogStats,
} from "@/lib/utils/agent-log-stats";

export interface LogDetailContentProps {
  conversation: ParsedMessage[] | null;
  stats: AgentLogStats | null;
  rawContent: string;
  loading: boolean;
  error: string | null;
  variant?: "modal" | "page";
}

export function extractTextContent(message: ParsedMessage): string | null {
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

export function extractToolCalls(content: ParsedMessage["content"]): ToolCallContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is ToolCallContent =>
      part != null && typeof part === "object" && part.type === "tool-call",
  );
}

export function extractToolResults(content: ParsedMessage["content"]): ToolResultContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is ToolResultContent =>
      part != null && typeof part === "object" && part.type === "tool-result",
  );
}

export function getToolResultValue(output: ToolResultContent["output"]): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "value" in output) {
    const val = output.value;
    if (typeof val === "string") {
      return val.length > 2000 ? val.slice(0, 2000) + "\n... (truncated)" : val;
    }
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function ToolCallItem({
  tc,
}: {
  tc: { id?: string; name: string; args: string | null };
}) {
  const [open, setOpen] = useState(false);
  const truncated =
    tc.args && tc.args.length > 2000 ? tc.args.slice(0, 2000) + "\n... (truncated)" : tc.args;

  return (
    <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 font-mono break-words">
      <button
        onClick={() => truncated && setOpen((s) => !s)}
        className={cn(
          "text-left w-full",
          truncated ? "hover:text-foreground transition-colors cursor-pointer" : "cursor-default",
        )}
      >
        Called <span className="font-semibold">{tc.name}</span>
        {truncated && (
          <span className="ml-1 text-muted-foreground/70">{open ? "(hide)" : "(show)"}</span>
        )}
      </button>
      {open && truncated && (
        <pre className="mt-1 text-xs font-mono bg-muted/70 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
          {truncated}
        </pre>
      )}
    </div>
  );
}

export function MessageBubble({ message }: { message: ParsedMessage }) {
  const [showToolDetails, setShowToolDetails] = useState(false);

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

  const allToolCallNames = [
    ...toolCalls.map((tc) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      args: tc.input !== undefined ? JSON.stringify(tc.input, null, 2) : null,
    })),
    ...openaiToolCalls
      .filter((tc) => tc && typeof tc === "object" && tc.function?.name)
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: tc.function.arguments ?? null,
      })),
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
            <ToolCallItem key={tc.id || i} tc={tc} />
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
    const truncated =
      content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content;
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
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/50 border",
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap break-words">{textContent}</p>
        ) : (
          <MarkdownRenderer variant="assistant" size="compact">
            {textContent}
          </MarkdownRenderer>
        )}
        {/* Inline tool calls in assistant messages with text */}
        {isAssistant && allToolCallNames.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
            {allToolCallNames.map((tc, i) => (
              <ToolCallItem key={tc.id || i} tc={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatsBar({ stats }: { stats: AgentLogStats }) {
  const [showBash, setShowBash] = useState(false);
  const [showDeveloperShell, setShowDeveloperShell] = useState(false);

  const hasToolCalls = stats.totalToolCalls > 0;
  const sortedTools = hasToolCalls
    ? Object.entries(stats.toolFrequency).sort((a, b) => b[1] - a[1])
    : [];
  const hasBashFrequency = Object.keys(stats.bashFrequency ?? {}).length > 0;
  const sortedBash = hasBashFrequency
    ? Object.entries(stats.bashFrequency).sort((a, b) => b[1] - a[1])
    : [];
  const hasDeveloperShellFrequency = Object.keys(stats.developerShellFrequency ?? {}).length > 0;
  const sortedDeveloperShell = hasDeveloperShellFrequency
    ? Object.entries(stats.developerShellFrequency).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 space-y-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{stats.totalMessages}</span> messages
        {" · "}~
        <span className="font-medium text-foreground">
          {stats.estimatedTokens.toLocaleString()}
        </span>{" "}
        tokens
        {" · "}
        <span className="font-medium text-foreground">{stats.totalToolCalls}</span> tool call
        {stats.totalToolCalls !== 1 ? "s" : ""}
      </p>
      {hasToolCalls && (
        <div className="flex flex-wrap gap-1.5">
          {sortedTools.map(([name, count]) =>
            name === "bash" && hasBashFrequency ? (
              <button key={name} onClick={() => setShowBash((s) => !s)} className="inline-flex items-center">
                <Badge
                  variant="secondary"
                  className="text-xs font-mono px-1.5 py-0 brightness-125 cursor-pointer hover:brightness-150 transition-[filter]"
                >
                  {name} ×{count}
                </Badge>
              </button>
            ) : name === "developer__shell" && hasDeveloperShellFrequency ? (
              <button
                key={name}
                onClick={() => setShowDeveloperShell((s) => !s)}
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
            ),
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
      {showDeveloperShell && hasDeveloperShellFrequency && (
        <div className="flex flex-wrap gap-1.5 pl-2 border-l-2 border-muted-foreground/30">
          {sortedDeveloperShell.map(([cmd, count]) => (
            <Badge key={cmd} variant="outline" className="text-xs font-mono px-1.5 py-0">
              {cmd} ×{count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function LogDetailContent({
  conversation,
  stats,
  rawContent,
  loading,
  error,
  variant = "modal",
}: LogDetailContentProps) {
  const scrollHeight = variant === "page" ? "h-[calc(100vh-12rem)]" : "h-[400px]";
  const hasContent = conversation !== null || rawContent !== "";

  return (
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
          <ScrollArea
            className={cn(
              scrollHeight,
              "w-full rounded-md border [&_[data-radix-scroll-area-viewport]>div]:!block",
            )}
          >
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
  );
}
