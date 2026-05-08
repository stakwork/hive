"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPusherClient, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { LayoutAlgorithm, ParsedDiagram } from "@/services/excalidraw-layout";
import { extractParsedDiagram, relayoutDiagram, serializeDiagramContext } from "@/services/excalidraw-layout";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";
import { ChevronDown, ChevronLeft, ChevronRight, HelpCircle, Loader2, Mic, MicOff, Send } from "lucide-react";
import { toast } from "sonner";
import { ClarifyingQuestionsPreview } from "@/components/features/ClarifyingQuestionsPreview";
import type { ClarifyingQuestion } from "@/types/stakwork";

interface WhiteboardMessageMetadata {
  tool_use?: string;
  content?: ClarifyingQuestion[];
}

interface WhiteboardMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  userId: string | null;
  metadata?: WhiteboardMessageMetadata;
}

interface WhiteboardChatPanelProps {
  whiteboardId: string;
  featureId: string | null;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onReloadWhiteboard: () => Promise<void>;
}

function parseQAPairs(text: string): { question: string; answer: string }[] {
  return text
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const question = lines[0]?.replace(/^Q:\s*/, "") ?? "";
      const answer = lines[1]?.replace(/^A:\s*/, "") ?? "";
      return { question, answer };
    })
    .filter((pair) => pair.question.length > 0);
}

function AnsweredClarifyingQuestions({
  questions,
  replyContent,
}: {
  questions: ClarifyingQuestion[];
  replyContent: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const pairs = parseQAPairs(replyContent);
  const count = questions.length;

  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <HelpCircle className="h-3 w-3" />
        <span>
          {count} {count === 1 ? "question" : "questions"} answered
        </span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          {pairs.map((pair, i) => (
            <div key={i}>
              <p className="font-medium text-foreground text-sm">{pair.question}</p>
              <p className="text-muted-foreground text-sm pl-2 border-l border-border ml-1 mt-0.5">
                {pair.answer}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WhiteboardChatPanel({
  whiteboardId,
  featureId: _featureId,
  excalidrawAPI,
  onReloadWhiteboard,
}: WhiteboardChatPanelProps) {
  const [messages, setMessages] = useState<WhiteboardMessage[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`whiteboard-chat-collapsed-${whiteboardId}`);
      if (saved !== null) return saved === "true";
    }
    return true;
  });
  const [layout, setLayout] = useState<LayoutAlgorithm>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`whiteboard-layout-${whiteboardId}`);
      if (
        saved === "layered" ||
        saved === "force" ||
        saved === "stress" ||
        saved === "mrtree"
      ) {
        return saved;
      }
    }
    return "layered";
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pusherRef = useRef<ReturnType<typeof getPusherClient> | null>(null);
  const preVoiceInputRef = useRef("");
  const parsedDiagramRef = useRef<ParsedDiagram | null>(null);

  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Derived: find the last ASSISTANT message with pending clarifying questions
  // (i.e., no USER message follows it)
  const pendingClarificationMessage = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "ASSISTANT");
    if (lastAssistant?.metadata?.tool_use === "ask_clarifying_questions") {
      const lastAssistantIdx = messages.lastIndexOf(lastAssistant);
      const hasUserReplyAfter = messages
        .slice(lastAssistantIdx + 1)
        .some((m) => m.role === "USER");
      return hasUserReplyAfter ? null : lastAssistant;
    }
    return null;
  }, [messages]);

  const hasPendingClarification = !!pendingClarificationMessage;

  // Sync speech transcript into textarea
  useEffect(() => {
    if (transcript) {
      const newValue = preVoiceInputRef.current
        ? `${preVoiceInputRef.current} ${transcript}`.trim()
        : transcript;
      setInput(newValue);
    }
  }, [transcript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      preVoiceInputRef.current = input;
      startListening();
    }
  }, [isListening, stopListening, startListening, input]);

  useControlKeyHold({
    onStart: () => {
      preVoiceInputRef.current = input;
      startListening();
    },
    onStop: stopListening,
    enabled: isSupported && !generating,
  });

  // Fetch messages on mount
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/whiteboards/${whiteboardId}/messages`);
        const data = await res.json();
        if (data.success) {
          setMessages(data.data || []);
        }
      } catch (error) {
        console.error("Error loading messages:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [whiteboardId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  // Pusher subscription for real-time ASSISTANT messages
  useEffect(() => {
    let pusher: ReturnType<typeof getPusherClient> | null = null;
    let channel: ReturnType<
      ReturnType<typeof getPusherClient>["subscribe"]
    > | null = null;

    try {
      pusher = getPusherClient();
      pusherRef.current = pusher;
      const channelName = getWhiteboardChannelName(whiteboardId);
      channel = pusher.subscribe(channelName);

      channel.bind(
        PUSHER_EVENTS.WHITEBOARD_CHAT_MESSAGE,
        async (data: { message: WhiteboardMessage }) => {
          setMessages((prev) => [...prev, data.message]);
          setGenerating(false);

          // Only reload whiteboard/scroll for actual diagram messages (not clarifying questions)
          const meta = data.message.metadata as WhiteboardMessageMetadata | undefined;
          if (meta?.tool_use !== "ask_clarifying_questions") {
            await onReloadWhiteboard();
            if (excalidrawAPI) {
              parsedDiagramRef.current = extractParsedDiagram(
                excalidrawAPI.getSceneElements() as unknown as readonly Record<
                  string,
                  unknown
                >[]
              );
              excalidrawAPI.scrollToContent(undefined, {
                fitToViewport: true,
                viewportZoomFactor: 0.9,
                animate: true,
                duration: 300,
              });
            }
          }
        }
      );
    } catch {
      // Pusher not configured in this environment
      return;
    }

    return () => {
      channel?.unbind(PUSHER_EVENTS.WHITEBOARD_CHAT_MESSAGE);
      if (pusher && channel) {
        const channelName = getWhiteboardChannelName(whiteboardId);
        pusher.unsubscribe(channelName);
      }
    };
  }, [whiteboardId, excalidrawAPI, onReloadWhiteboard]);

  const handleSend = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || generating || hasPendingClarification) return;

    // Optimistic USER message
    const optimisticMessage: WhiteboardMessage = {
      id: `temp-${Date.now()}`,
      role: "USER",
      content: trimmedInput,
      createdAt: new Date().toISOString(),
      userId: null,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInput("");
    if (isListening) stopListening();
    resetTranscript();
    preVoiceInputRef.current = "";
    setGenerating(true);

    try {
      // Extract compact diagram context from current canvas elements
      const diagramContext = excalidrawAPI
        ? serializeDiagramContext(
            excalidrawAPI.getSceneElements() as unknown as readonly Record<
              string,
              unknown
            >[]
          )
        : null;

      const res = await fetch(`/api/whiteboards/${whiteboardId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmedInput, layout, diagramContext }),
      });

      if (res.status === 409) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
        toast.error("Diagram generation already in progress");
        setGenerating(false);
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      const data = await res.json();
      // Replace optimistic message with real one
      if (data.success && data.data.message) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMessage.id ? data.data.message : m
          )
        );
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMessage.id));
      toast.error("Failed to send message");
      setGenerating(false);
    }
  }, [
    input,
    generating,
    hasPendingClarification,
    whiteboardId,
    excalidrawAPI,
    isListening,
    stopListening,
    resetTranscript,
    layout,
  ]);

  const handleClarifySubmit = useCallback(
    async (formattedAnswers: string) => {
      setGenerating(true);
      try {
        const res = await fetch(
          `/api/whiteboards/${whiteboardId}/messages/clarify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers: formattedAnswers, layout }),
          }
        );
        if (!res.ok) {
          setGenerating(false);
          toast.error("Failed to submit answers");
          return;
        }
        const data = await res.json();
        if (data.success && data.data.message) {
          setMessages((prev) => [...prev, data.data.message]);
        }
      } catch (error) {
        console.error("Error submitting clarifying answers:", error);
        setGenerating(false);
        toast.error("Failed to submit answers");
      }
    },
    [whiteboardId, layout]
  );

  const handleLayoutChange = async (newLayout: LayoutAlgorithm) => {
    setLayout(newLayout);
    localStorage.setItem(`whiteboard-layout-${whiteboardId}`, newLayout);

    // Lazily populate ref from live canvas if not yet set by Pusher handler
    if (!parsedDiagramRef.current && excalidrawAPI) {
      parsedDiagramRef.current = extractParsedDiagram(
        excalidrawAPI.getSceneElements() as unknown as readonly Record<
          string,
          unknown
        >[]
      );
    }

    const diagram = parsedDiagramRef.current;
    if (!diagram || !excalidrawAPI) return;

    try {
      const data = await relayoutDiagram(diagram, newLayout);
      excalidrawAPI.updateScene({
        elements: data.elements as unknown as readonly ExcalidrawElement[],
        appState: data.appState as unknown as AppState,
      });
      setTimeout(() => {
        excalidrawAPI.scrollToContent(undefined, {
          fitToViewport: true,
          viewportZoomFactor: 0.9,
          animate: true,
          duration: 300,
        });
      }, 100);
    } catch (err) {
      console.error("Error re-laying out diagram:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isCollapsed) {
    return (
      <div className="absolute right-2 top-2 z-10">
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setIsCollapsed(false);
            localStorage.setItem(`whiteboard-chat-collapsed-${whiteboardId}`, "false");
          }}
          title="Expand chat"
          className="h-8 w-8"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 flex flex-col w-80 bg-sidebar border-l border-sidebar-border shadow-lg z-10 rounded-r-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-sidebar-border">
        <h3 className="font-medium text-sm">Chat</h3>
        <div className="flex items-center gap-2">
          <Select
            value={layout}
            onValueChange={(v) => handleLayoutChange(v as LayoutAlgorithm)}
          >
            <SelectTrigger className="w-[130px] h-6 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="layered">Hierarchical</SelectItem>
              <SelectItem value="force">Force</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsCollapsed(true);
              localStorage.setItem(`whiteboard-chat-collapsed-${whiteboardId}`, "true");
            }}
            title="Collapse chat"
            className="h-6 w-6"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground text-center px-4">
            No messages yet. Ask a question to update the diagram.
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, idx) => {
              const meta = message.metadata as WhiteboardMessageMetadata | undefined;
              const isClarifyingMessage =
                message.role === "ASSISTANT" &&
                meta?.tool_use === "ask_clarifying_questions" &&
                Array.isArray(meta.content) &&
                meta.content.length > 0;

              if (isClarifyingMessage) {
                const isPending = message === pendingClarificationMessage;
                const questions = meta!.content!;

                if (isPending) {
                  // Render inline in message list — the footer also shows the widget
                  return (
                    <div key={message.id} className="flex justify-start">
                      <div className="max-w-[95%] w-full">
                        <p className="text-xs text-muted-foreground mb-1">
                          {message.content}
                        </p>
                        <ClarifyingQuestionsPreview
                          questions={questions}
                          onSubmit={handleClarifySubmit}
                          isLoading={generating}
                        />
                      </div>
                    </div>
                  );
                }

                // Answered state: find the next USER message after this one
                const nextUserMessage = messages
                  .slice(idx + 1)
                  .find((m) => m.role === "USER");

                return (
                  <div key={message.id} className="flex justify-start">
                    <div className="max-w-[95%] w-full">
                      <AnsweredClarifyingQuestions
                        questions={questions}
                        replyContent={nextUserMessage?.content ?? ""}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "USER" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      message.role === "USER"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      {hasPendingClarification ? (
        <div className="p-3 border-t border-sidebar-border">
          {generating && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Generating diagram...</span>
            </div>
          )}
          <ClarifyingQuestionsPreview
            questions={pendingClarificationMessage!.metadata!.content!}
            onSubmit={handleClarifySubmit}
            isLoading={generating}
          />
        </div>
      ) : (
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {generating && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Generating diagram...</span>
            </div>
          )}
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? "Listening..." : "Ask to update the diagram..."}
              disabled={generating || hasPendingClarification}
              className="min-h-[80px] max-h-[160px] resize-none overflow-y-auto pr-10"
            />
            {isSupported && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={toggleListening}
                      disabled={generating || hasPendingClarification}
                      size="icon"
                      variant="ghost"
                      data-testid="mic-button"
                      className={`absolute right-1.5 top-1.5 h-7 w-7 ${
                        isListening
                          ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isListening ? (
                        <MicOff className="w-3.5 h-3.5" />
                      ) : (
                        <Mic className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {isListening
                      ? "Stop recording"
                      : "Start voice input (or hold Ctrl)"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <Button
            onClick={handleSend}
            disabled={!input.trim() || generating || hasPendingClarification}
            size="sm"
            className="w-full"
          >
            <Send className="w-3.5 h-3.5 mr-2" />
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
