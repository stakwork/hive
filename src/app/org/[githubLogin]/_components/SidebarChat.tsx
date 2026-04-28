"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelMessage } from "ai";
import { Send, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useStreamProcessor } from "@/lib/streaming";
import { ChatMessage } from "@/components/dashboard/DashboardChat/ChatMessage";
import { ToolCallIndicator } from "@/components/dashboard/DashboardChat/ToolCallIndicator";
import { Button } from "@/components/ui/button";

/**
 * The org-canvas sidebar chat. Lives in the third tab of
 * `OrgRightPanel` and replaces the bottom-anchored `DashboardChat`
 * overlay that used to share the canvas column.
 *
 * This is a *different* product surface from `DashboardChat`: no
 * image upload, no multi-workspace pills, no follow-up questions, no
 * provenance sidebar, no Generate Plan / Recent Chats / Read-only
 * affordances. The agent's home base on the canvas — designed to
 * grow toward rich artifacts (live task status, PR cards, propose-
 * canvas-change, deep-research handles), not toward the dashboard's
 * workspace-question UX.
 *
 * Reuses `ChatMessage`, `ToolCallIndicator`, and `useStreamProcessor`
 * from the dashboard chat unchanged.
 */
interface ToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status: string;
  output?: unknown;
  errorText?: string;
}

export interface SidebarMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  /**
   * Forward-compat slot for rich agent artifacts (task-status cards,
   * PR lists, propose-canvas-change, deep-research handles). Not yet
   * rendered — `<MessageArtifacts />` below is the single dispatch
   * point that grows when the first artifact type ships. Intentionally
   * `unknown[]`: typed when the first artifact is built.
   */
  artifacts?: unknown[];
}

interface SidebarChatProps {
  /** Slug of the org (the `[githubLogin]` route param). */
  githubLogin: string;
  /** Canvas org id, used to scope agent tool calls. */
  orgId: string;
  /**
   * Workspace slugs the agent should be allowed to read from. Derived
   * by `OrgCanvasView` from non-hidden workspaces on the canvas. The
   * user cannot edit this from the sidebar; hidden state is owned by
   * the canvas's `HiddenLivePill`.
   */
  workspaceSlugs: string[];
  /**
   * Current canvas scope (`""` for root, `"initiative:<id>"` /
   * `"ws:<id>"` for sub-canvases). Threaded into `/api/ask/quick` so
   * tool calls default to the right ref.
   */
  currentCanvasRef: string;
  /** Human-readable breadcrumb for the current scope. */
  currentCanvasBreadcrumb: string;
  /** Selected canvas node id, or null. Lets the agent resolve "this". */
  selectedNodeId: string | null;
  /**
   * Optional preloaded message history (e.g. from a `?chat=<shareId>`
   * deep link). When set, used as the initial value of `messages`.
   * No "loaded from share" tracking — the user just continues from
   * here; auto-save creates a fresh `isShared: false` row on their
   * first message.
   */
  initialMessages?: SidebarMessage[];
}

export function SidebarChat({
  githubLogin,
  orgId,
  workspaceSlugs,
  currentCanvasRef,
  currentCanvasBreadcrumb,
  selectedNodeId,
  initialMessages,
}: SidebarChatProps) {
  const { slug } = useWorkspace();
  const { data: _session } = useSession();
  const [messages, setMessages] = useState<SidebarMessage[]>(initialMessages ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const hasReceivedContentRef = useRef(false);
  const assistantMsgsRef = useRef<SidebarMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { processStream } = useStreamProcessor();

  // Scroll the messages container (not the page) to the bottom on
  // updates. Using `scrollTop = scrollHeight` instead of
  // `scrollIntoView` so the page never gets dragged when a streaming
  // delta lands and the inner anchor isn't the nearest scrollable.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, activeToolCalls]);

  // Fire-and-forget auto-save helpers. The endpoint is keyed on the
  // user's *current workspace* slug, matching `DashboardChat`'s
  // behavior — there's no org-scoped chat conversation table.
  const autoSaveCreate = (msgs: SidebarMessage[]) => {
    if (!slug) return;
    fetch(`/api/workspaces/${slug}/chat/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs,
        settings: { extraWorkspaceSlugs: workspaceSlugs },
        source: "org-canvas",
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.id) conversationIdRef.current = data.id;
      })
      .catch(() => {});
  };

  const autoSaveAppend = (msgs: SidebarMessage[]) => {
    if (!slug || !conversationIdRef.current) return;
    fetch(
      `/api/workspaces/${slug}/chat/conversations/${conversationIdRef.current}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: msgs,
          settings: { extraWorkspaceSlugs: workspaceSlugs },
        }),
      },
    ).catch(() => {});
  };

  const handleSend = async (content: string, clearInput: () => void) => {
    if (!content.trim()) return;

    const userMessage: SidebarMessage = {
      id: Date.now().toString(),
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setIsLoading(true);
    hasReceivedContentRef.current = false;

    // Auto-save: create on first message, append delta thereafter.
    // The server PUT reads existing JSON, concatenates, writes back —
    // so we send only the new message on append, never the full array.
    if (conversationIdRef.current === null) {
      autoSaveCreate(updatedMessages);
    } else {
      autoSaveAppend([userMessage]);
    }

    try {
      const response = await fetch(`/api/ask/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages
            .filter((m) => m.content.trim() || m.toolCalls)
            .flatMap((m): ModelMessage[] => {
              if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
                const out: ModelMessage[] = [];
                out.push({
                  role: m.role,
                  content: m.toolCalls.map((tc) => ({
                    type: "tool-call" as const,
                    toolCallId: tc.id,
                    toolName: tc.toolName,
                    input: tc.input || {},
                  })),
                });
                const toolResults = m.toolCalls.filter(
                  (tc) => tc.output !== undefined || tc.errorText !== undefined,
                );
                if (toolResults.length > 0) {
                  out.push({
                    role: "tool" as const,
                    content: toolResults.map((tc) => {
                      let wrappedOutput = tc.output;
                      if (
                        tc.output &&
                        typeof tc.output === "object" &&
                        !("type" in tc.output)
                      ) {
                        wrappedOutput = { type: "json", value: tc.output };
                      }
                      return {
                        type: "tool-result" as const,
                        toolCallId: tc.id,
                        toolName: tc.toolName,
                        output: wrappedOutput as never,
                      };
                    }),
                  } satisfies ModelMessage);
                }
                if (m.content) {
                  out.push({ role: m.role, content: m.content });
                }
                return out;
              }
              return [{ role: m.role, content: m.content }];
            }),
          // The org canvas always sends a multi-workspace request
          // (the agent's `read from these workspaces` is the
          // visible-on-canvas list); when none are visible, fall
          // back to the user's current workspace slug.
          ...(workspaceSlugs.length > 0
            ? { workspaceSlugs: [slug, ...workspaceSlugs].filter(Boolean) }
            : { workspaceSlug: slug }),
          orgId,
          currentCanvasRef,
          ...(currentCanvasBreadcrumb ? { currentCanvasBreadcrumb } : {}),
          ...(selectedNodeId ? { selectedNodeId } : {}),
          // Skip the `after()` enrichment block server-side: this
          // surface renders neither follow-up questions nor a
          // provenance tree, so computing them would be wasted tokens.
          skipEnrichments: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const messageId = (Date.now() + 1).toString();
      const loggedToolCalls = new Set<string>();

      await processStream(response, messageId, (updatedMessage) => {
        if (!hasReceivedContentRef.current) {
          hasReceivedContentRef.current = true;
          setIsLoading(false);
          clearInput();
        }

        const timeline = updatedMessage.timeline || [];
        const timelineMessages: SidebarMessage[] = [];
        let currentText = "";
        let currentToolCalls: ToolCall[] = [];
        let msgCounter = 0;

        for (const item of timeline) {
          if (item.type === "text") {
            currentText += (item.data as { content: string }).content;
          } else if (item.type === "toolCall") {
            if (currentText.trim()) {
              timelineMessages.push({
                id: `${messageId}-${msgCounter++}`,
                role: "assistant",
                content: currentText,
                timestamp: new Date(),
              });
              currentText = "";
            }
            const toolCall = item.data as {
              id: string;
              toolName: string;
              input?: unknown;
              output?: unknown;
              status: string;
            };

            // Debug logging on the org canvas page or when DEBUG is
            // set. Same gate as `DashboardChat` so canvas tool-call
            // traces stay easy to read while bringing this up.
            if (
              typeof window !== "undefined" &&
              (/^\/org\/[^/]+$/.test(window.location.pathname) ||
                (window as Window & { DEBUG?: boolean }).DEBUG)
            ) {
              const callKey = `${toolCall.id}-${toolCall.status}`;
              if (!loggedToolCalls.has(callKey)) {
                loggedToolCalls.add(callKey);
                if (toolCall.status === "call") {
                  console.log(
                    `%c[TOOL CALL] ${toolCall.toolName}`,
                    "color: #4fc3f7; font-weight: bold",
                    JSON.stringify(toolCall.input),
                  );
                }
                if (toolCall.output !== undefined) {
                  console.log(
                    `%c[TOOL RESULT] ${toolCall.toolName}`,
                    "color: #81c784; font-weight: bold",
                    JSON.stringify(toolCall.output),
                  );
                }
                if (toolCall.status === "output-error") {
                  console.log(
                    `%c[TOOL ERROR] ${toolCall.toolName}`,
                    "color: #e57373; font-weight: bold",
                    JSON.stringify(toolCall.output),
                  );
                }
              }
            }

            currentToolCalls.push({
              id: toolCall.id,
              toolName: toolCall.toolName,
              input: toolCall.input,
              status: toolCall.status,
              output: toolCall.output,
              errorText:
                toolCall.status === "output-error" ? "Tool call failed" : undefined,
            });
          }
        }

        if (currentToolCalls.length > 0) {
          timelineMessages.push({
            id: `${messageId}-${msgCounter++}`,
            role: "assistant",
            content: "",
            timestamp: new Date(),
            toolCalls: currentToolCalls,
          });
          currentToolCalls = [];
        }

        if (currentText.trim()) {
          timelineMessages.push({
            id: `${messageId}-${msgCounter++}`,
            role: "assistant",
            content: currentText,
            timestamp: new Date(),
          });
        }

        const lastMsg = timelineMessages[timelineMessages.length - 1];
        if (lastMsg?.toolCalls && lastMsg.toolCalls.length > 0) {
          setActiveToolCalls(lastMsg.toolCalls);
        } else {
          setActiveToolCalls([]);
        }

        assistantMsgsRef.current = timelineMessages;

        setMessages((prev) => {
          const filteredPrev = prev.filter((m) => !m.id.startsWith(messageId));
          return [...filteredPrev, ...timelineMessages];
        });
      });

      setActiveToolCalls([]);
    } catch (error) {
      console.error("Error calling ask API:", error);
      const errorMessage: SidebarMessage = {
        id: (Date.now() + 1).toString(),
        content:
          "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setActiveToolCalls([]);
    } finally {
      setIsLoading(false);
      if (conversationIdRef.current) {
        const assistantMsgs = assistantMsgsRef.current;
        if (assistantMsgs.length > 0) {
          autoSaveAppend(assistantMsgs);
        }
      }
      assistantMsgsRef.current = [];
    }
  };

  const handleClear = () => {
    setMessages([]);
    conversationIdRef.current = null;
    assistantMsgsRef.current = [];
    setActiveToolCalls([]);
  };

  const handleShare = async () => {
    if (messages.length === 0) return;
    try {
      const firstUserMessage = messages.find(
        (m) => m.role === "user" && m.content.trim(),
      );
      const title = firstUserMessage
        ? firstUserMessage.content.slice(0, 50) +
          (firstUserMessage.content.length > 50 ? "..." : "")
        : "Shared Conversation";

      const res = await fetch(`/api/org/${githubLogin}/chat/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          title,
          // The endpoint requires this field; we have nothing to
          // share. `[]` is truthy in JS so the falsy guard accepts it.
          followUpQuestions: [],
          source: "org-canvas",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to share conversation");
      }
      const data = await res.json();
      // Use the forking URL shape `?chat=<shareId>` rather than the
      // standalone read-only viewer at `/chat/shared/<shareId>` that
      // the server returns. The viewer page still works for anyone
      // who lands on it directly.
      const url = `${window.location.origin}/org/${githubLogin}?chat=${data.shareId}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied to clipboard!");
    } catch (error) {
      console.error("Error sharing conversation:", error);
      toast.error("Failed to share conversation", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Header: Share + Clear actions. Kept minimal — there's no
          conversation title or tab affordance here; tabs live on the
          parent panel. */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium text-muted-foreground">Agent</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleShare}
            disabled={!hasMessages}
            title="Copy share link"
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!hasMessages}
            title="Clear conversation"
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
        {!hasMessages && activeToolCalls.length === 0 && (
          <div className="h-full flex items-center justify-center px-4 text-center text-muted-foreground text-sm">
            Ask the agent about anything on this canvas.
          </div>
        )}
        <div className="space-y-2">
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1;
            const isMessageStreaming = isLastMessage && isLoading;
            return (
              <div key={message.id}>
                <ChatMessage
                  message={message}
                  isStreaming={isMessageStreaming}
                />
                <MessageArtifacts artifacts={message.artifacts} />
              </div>
            );
          })}
          {activeToolCalls.length > 0 && (
            <ToolCallIndicator toolCalls={activeToolCalls} />
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <SidebarChatInput onSend={handleSend} disabled={isLoading} />
      </div>
    </div>
  );
}

/**
 * Forward-compat dispatch point for rich agent artifacts. Renders
 * nothing in PR 1 — added here so every artifact type addition lands
 * as one switch arm and one renderer file rather than a fork through
 * `ChatMessage`. See `docs/plans/canvas-sidebar-chat.md` ("Long-term:
 * rich artifacts") for the planned types (task-status, pr-list,
 * propose-canvas-change, deep-research).
 *
 * Note re: `useStreamProcessor`: the timeline today only emits
 * `text` / `reasoning` / `toolCall`. When the first artifact ships,
 * the cheapest path is to ride on top of specific tool-result names
 * (e.g. `propose_canvas_change` → artifact) and bucket them in this
 * component, rather than forking the hook.
 */
function MessageArtifacts({ artifacts }: { artifacts?: unknown[] }) {
  if (!artifacts || artifacts.length === 0) return null;
  return null;
}

interface SidebarChatInputProps {
  onSend: (message: string, clearInput: () => void) => Promise<void>;
  disabled?: boolean;
}

/**
 * Minimal chat input for the sidebar. Auto-growing textarea (1–6
 * rows), Enter-to-send, Shift+Enter for newline. Intentionally
 * separate from `DashboardChat/ChatInput` — the prop surface
 * diverges far enough that sharing would require ugly conditionals
 * (no image upload, no workspace pills, no `+ workspace` button).
 */
function SidebarChatInput({ onSend, disabled = false }: SidebarChatInputProps) {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!input) {
      setRows(1);
      return;
    }
    const lineCount = (input.match(/\n/g) || []).length + 1;
    setRows(Math.max(1, Math.min(6, lineCount)));
  }, [input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    await onSend(message, () => {
      setInput("");
      inputRef.current?.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="relative flex-1 min-w-0">
        <textarea
          ref={inputRef}
          placeholder="Ask the agent…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={rows}
          className={`w-full px-3 py-2 pr-10 rounded-xl bg-background border border-border/50 text-sm text-foreground/95 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || disabled}
          className="absolute right-1 bottom-1 h-7 w-7 rounded-full"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </form>
  );
}
