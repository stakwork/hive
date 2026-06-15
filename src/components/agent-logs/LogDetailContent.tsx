"use client";

import React, { useState } from "react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, User, Bot, Wrench, Code2, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import { buildToolCallIndex, getConsumedResultIds } from "@/lib/utils/agent-log-pairing";
import type {
  ParsedMessage,
  ToolCallContent,
  ToolResultContent,
  AgentLogStats,
  AgentRunConfig,
} from "@/lib/utils/agent-log-stats";

export interface LogDetailContentProps {
  conversation: ParsedMessage[] | null;
  stats: AgentLogStats | null;
  config?: AgentRunConfig | null;
  rawContent: string;
  loading: boolean;
  error: string | null;
  variant?: "modal" | "page";
}

/** Characters before assistant text is truncated with a "Show more" button */
const LONG_TEXT_THRESHOLD = 1500;

export function unescapeLogString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
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
  if (typeof output === "string") return unescapeLogString(output);
  if (output && typeof output === "object" && "value" in output) {
    const val = output.value;
    if (typeof val === "string") {
      return unescapeLogString(val.length > 2000 ? val.slice(0, 2000) + "\n... (truncated)" : val);
    }
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

// ---------------------------------------------------------------------------
// CopyButton — icon-only, swaps to Check for 1.5 s after click
// ---------------------------------------------------------------------------

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            "shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded",
            className,
          )}
          aria-label="Copy"
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{copied ? "Copied!" : "Copy"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// SystemMessageBubble — collapsed by default, distinct muted styling
// ---------------------------------------------------------------------------

export function SystemMessageBubble({ message }: { message: ParsedMessage }) {
  const [expanded, setExpanded] = useState(false);
  const textContent = extractTextContent(message) ?? "";
  const charCount = textContent.length;

  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2">
      <button
        onClick={() => setExpanded((s) => !s)}
        className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <span className="font-medium">System prompt</span>
        <Badge variant="secondary" className="text-xs px-1.5 py-0 ml-1">
          {charCount.toLocaleString()} chars
        </Badge>
      </button>
      {expanded && (
        <div className="mt-2">
          <MarkdownRenderer variant="assistant" size="compact">
            {textContent}
          </MarkdownRenderer>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallItem — expanded by default; optionally renders paired result inline
// ---------------------------------------------------------------------------

export function ToolCallItem({
  tc,
  pairedResult,
}: {
  tc: { id?: string; name: string; args: string | null };
  pairedResult?: ToolResultContent;
}) {
  const [open, setOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);

  const truncated =
    tc.args && tc.args.length > 2000 ? tc.args.slice(0, 2000) + "\n... (truncated)" : tc.args;
  const unescapedArgs = truncated ? unescapeLogString(truncated) : null;

  return (
    <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 font-mono break-words">
      {/* Header row */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => truncated && setOpen((s) => !s)}
          className={cn(
            "text-left flex-1",
            truncated ? "hover:text-foreground transition-colors cursor-pointer" : "cursor-default",
          )}
        >
          Called <span className="font-semibold">{tc.name}</span>
          {truncated && (
            <span className="ml-1 text-muted-foreground/70">{open ? "(hide)" : "(show)"}</span>
          )}
        </button>
        {unescapedArgs && (
          <CopyButton value={unescapedArgs} />
        )}
      </div>

      {/* Args body */}
      {open && truncated && (
        <pre className="mt-1 text-xs font-mono bg-muted/70 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
          {unescapedArgs}
        </pre>
      )}

      {/* Inline paired result */}
      {pairedResult && (
        <div className="mt-1.5 border-l-2 border-primary/30 pl-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setResultOpen((s) => !s)}
              className="text-left flex-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Result {resultOpen ? "(hide)" : "(show)"}
            </button>
            <CopyButton value={getToolResultValue(pairedResult.output)} />
          </div>
          {resultOpen && (
            <pre className="mt-1 text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
              {getToolResultValue(pairedResult.output)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function formatMsgTime(ts: string): string {
  try {
    return format(new Date(ts), "HH:mm");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

export function MessageBubble({
  message,
  toolCallIndex,
  consumedResultIds,
}: {
  message: ParsedMessage;
  toolCallIndex?: Map<string, ToolResultContent>;
  consumedResultIds?: Set<string>;
}) {
  const [showToolDetails, setShowToolDetails] = useState(false);
  const [showMore, setShowMore] = useState(false);

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

  // --- System message ---
  if (role === "system") {
    return <SystemMessageBubble message={message} />;
  }

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
            <ToolCallItem
              key={tc.id || i}
              tc={tc}
              pairedResult={tc.id ? toolCallIndex?.get(tc.id) : undefined}
            />
          ))}
        </div>
      </div>
    );
  }

  // Tool result messages (Vercel AI SDK style)
  if (isTool && toolResults.length > 0) {
    // Filter out results that are paired with a call (already rendered inline)
    const unpairedResults = toolResults.filter(
      (tr) => !tr.toolCallId || !consumedResultIds?.has(tr.toolCallId),
    );

    if (unpairedResults.length === 0) return null;

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
            {unpairedResults.length} tool result{unpairedResults.length > 1 ? "s" : ""}{" "}
            {showToolDetails ? "(hide)" : "(show)"}
          </button>
          {showToolDetails && (
            <div className="mt-1 space-y-1">
              {unpairedResults.map((tr, i) => (
                <div key={tr.toolCallId || i} className="relative">
                  <div className="flex items-center gap-1 mb-0.5">
                    <CopyButton value={getToolResultValue(tr.output)} />
                  </div>
                  <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
                    {getToolResultValue(tr.output)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tool result messages (OpenAI style: role=tool with tool_call_id + string content)
  if (isTool && message.tool_call_id && typeof content === "string") {
    // Skip if this result is paired with a call (rendered inline)
    if (consumedResultIds?.has(message.tool_call_id)) return null;

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
            <div className="mt-1">
              <div className="flex items-center gap-1 mb-0.5">
                <CopyButton value={truncated} />
              </div>
              <pre className="text-xs font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
                {truncated}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Skip messages with no displayable content
  if (!textContent) return null;

  // Long-text truncation for assistant and user messages
  const isLong = (isAssistant || isUser) && textContent.length > LONG_TEXT_THRESHOLD;
  const displayedText =
    isLong && !showMore ? textContent.slice(0, LONG_TEXT_THRESHOLD) : textContent;

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
          <>
            <p className="text-sm whitespace-pre-wrap break-words">
              {unescapeLogString(displayedText)}
            </p>
            {isLong && (
              <button
                onClick={() => setShowMore((s) => !s)}
                className="mt-1 text-xs text-primary-foreground/70 hover:underline"
              >
                {showMore ? "Show less" : "Show more"}
              </button>
            )}
          </>
        ) : (
          <>
            <MarkdownRenderer variant="assistant" size="compact">
              {displayedText}
            </MarkdownRenderer>
            {isLong && (
              <button
                onClick={() => setShowMore((s) => !s)}
                className="mt-1 text-xs text-primary hover:underline"
              >
                {showMore ? "Show less" : "Show more"}
              </button>
            )}
          </>
        )}
        {/* Inline tool calls in assistant messages with text */}
        {isAssistant && allToolCallNames.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
            {allToolCallNames.map((tc, i) => (
              <ToolCallItem
                key={tc.id || i}
                tc={tc}
                pairedResult={tc.id ? toolCallIndex?.get(tc.id) : undefined}
              />
            ))}
          </div>
        )}
        {/* Timestamp label for user and assistant messages */}
        {message.timestamp && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn("mt-1 block text-[10px] opacity-50 select-none", isUser && "text-right")}>
                {formatMsgTime(message.timestamp)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{new Date(message.timestamp).toLocaleString()}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunConfigPanel — collapsible panel showing high-signal run config fields
// ---------------------------------------------------------------------------

function getRepoIdentifiers(repos: unknown[]): string[] {
  return repos
    .map((r) => {
      if (r && typeof r === "object") {
        const obj = r as Record<string, unknown>;
        return (obj.name ?? obj.url ?? obj.id ?? null) as string | null;
      }
      if (typeof r === "string") return r;
      return null;
    })
    .filter((v): v is string => v !== null && v !== "");
}

function getToolNames(tools: unknown): string[] {
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) return [];
  return Object.entries(tools as Record<string, unknown>)
    .filter(([, v]) => !!v)
    .map(([k]) => k);
}

export function RunConfigPanel({ config }: { config: AgentRunConfig }) {
  const [expanded, setExpanded] = useState(false);

  const repoIds = Array.isArray(config.repos) ? getRepoIdentifiers(config.repos) : [];
  const toolNames = getToolNames(config.tools);

  const rows: { label: string; value: string }[] = [];
  if (config.model) rows.push({ label: "Model", value: config.model });
  if (config.provider) rows.push({ label: "Provider", value: config.provider });
  if (config.source) rows.push({ label: "Source", value: config.source });
  if (config.temperature !== undefined && config.temperature !== null) {
    rows.push({ label: "Temp", value: String(config.temperature) });
  }
  if (repoIds.length > 0) rows.push({ label: "Repos", value: repoIds.join(", ") });
  if (toolNames.length > 0) rows.push({ label: "Tools", value: toolNames.join(", ") });

  if (rows.length === 0 && !expanded) return null;

  return (
    <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Run Config
        </span>
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-start gap-1.5 min-w-0">
              <span className="text-xs text-muted-foreground shrink-0">{label}:</span>
              <span className="text-xs font-mono text-foreground truncate" title={value}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div>
        <button
          onClick={() => setExpanded((s) => !s)}
          className="text-xs text-primary hover:underline flex items-center gap-0.5"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? "Hide raw config" : "Show raw config"}
        </button>
        {expanded && (
          <pre className="mt-2 text-xs font-mono bg-muted rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-words">
            {JSON.stringify(config, null, 2)}
          </pre>
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
  config,
  rawContent,
  loading,
  error,
  variant = "modal",
}: LogDetailContentProps) {
  const scrollHeight = variant === "page" ? "h-[calc(100vh-12rem)]" : "h-[400px]";
  const hasContent = conversation !== null || rawContent !== "";

  const toolCallIndex = conversation ? buildToolCallIndex(conversation) : new Map();
  const consumedResultIds = conversation ? getConsumedResultIds(conversation) : new Set<string>();

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
          {config && <RunConfigPanel config={config} />}
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
                  <MessageBubble
                    key={i}
                    message={msg}
                    toolCallIndex={toolCallIndex}
                    consumedResultIds={consumedResultIds}
                  />
                ))}
              </div>
            ) : (
              <pre className="p-4 whitespace-pre-wrap break-words font-mono text-sm">
                {unescapeLogString(rawContent)}
              </pre>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  );
}
