"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { ArrowUp, Bug, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/use-toast";
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  Option,
  createChatMessage,
  ArtifactType,
  FormContent,
  Artifact,
  BugReportContent,
} from "@/lib/chat";
import {
  FormArtifact,
  CodeArtifactPanel,
  BrowserArtifactPanel,
} from "./artifacts";
import { useParams } from "next/navigation";
import { usePusherConnection } from "@/hooks/usePusherConnection";

// Generate unique IDs to prevent collisions
function generateUniqueId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Debug Attachment Component
function DebugAttachment({ 
  artifact, 
  onRemove 
}: { 
  artifact: Artifact; 
  onRemove: () => void;
}) {
  const content = artifact.content as BugReportContent;
  const coordinateText = content.method === 'click' 
    ? `Click at (${content.coordinates?.x}, ${content.coordinates?.y})`
    : `Area (${content.coordinates?.x}, ${content.coordinates?.y}) → (${(content.coordinates?.x || 0) + (content.coordinates?.width || 0)}, ${(content.coordinates?.y || 0) + (content.coordinates?.height || 0)}) • ${content.coordinates?.width}×${content.coordinates?.height}px`;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg max-w-xs">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Bug className="w-4 h-4 text-orange-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-orange-900 truncate">
            Element Analysis
          </div>
          <div className="text-xs text-orange-700 truncate">
            {coordinateText}
          </div>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="flex-shrink-0 p-1 hover:bg-orange-100 rounded-full transition-colors"
        title="Remove debug data"
      >
        <X className="w-3 h-3 text-orange-600" />
      </button>
    </div>
  );
}

function TaskStartInput({ onStart }: { onStart: (task: string) => void }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onStart(value.trim());
    }
  };

  const hasText = value.trim().length > 0;

  const handleClick = () => {
    if (hasText) {
      onStart(value.trim());
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-[92vh] md:h-[97vh] bg-background">
      <h1 className="text-4xl font-bold text-foreground mb-10 text-center">
        What do you want to do?
      </h1>
      <Card className="relative w-full max-w-2xl p-0 bg-card rounded-3xl shadow-sm border-0 group">
        <Textarea
          ref={textareaRef}
          placeholder="Describe a task"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-none min-h-[180px] text-lg bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-8 pt-8 pb-16 rounded-3xl shadow-none"
          autoFocus
        />
        <Button
          type="button"
          variant="default"
          size="icon"
          className="absolute bottom-6 right-8 z-10 rounded-full shadow-lg transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring/60"
          style={{ width: 32, height: 32 }}
          disabled={!hasText}
          onClick={handleClick}
          tabIndex={0}
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </Card>
    </div>
  );
}

export default function TaskChatPage() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session } = useSession(); // TODO: Use for authentication when creating tasks
  const { toast } = useToast();
  const params = useParams();

  const slug = params.slug as string;
  const taskParams = params.taskParams as string[];

  const isNewTask = taskParams?.[0] === "new";
  const taskIdFromUrl = !isNewTask ? taskParams?.[0] : null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [started, setStarted] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(
    taskIdFromUrl
  );
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<ArtifactType | null>(null);

  // Handle incoming SSE messages
  const handleSSEMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  // Use the Pusher connection hook
  const { isConnected, error: connectionError } = usePusherConnection({
    taskId: currentTaskId,
    onMessage: handleSSEMessage,
  });

  // Show connection errors as toasts
  useEffect(() => {
    if (connectionError) {
      toast({
        title: "Connection Error",
        description:
          "Lost connection to chat server. Attempting to reconnect...",
        variant: "destructive",
      });
    }
    // toast in deps causes infinite re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionError]);

  const loadTaskMessages = useCallback(async (taskId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/tasks/${taskId}/messages`);

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data.messages) {
        setMessages(result.data.messages);
        console.log(`Loaded ${result.data.count} existing messages for task`);
      }
    } catch (error) {
      console.error("Error loading task messages:", error);
      toast({
        title: "Error",
        description: "Failed to load existing messages.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // If we have a task ID from URL, we can optionally load existing messages
    if (taskIdFromUrl) {
      setStarted(true);
      // load existing chat messages for this task
      loadTaskMessages(taskIdFromUrl);
    }
  }, [taskIdFromUrl, loadTaskMessages]);

  useEffect(() => {
    if (started) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, started]);

  const handleStart = async (msg: string) => {
    if (isNewTask) {
      // Create new task
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: msg,
          description: "New task description", // TODO: Add description
          status: "active",
          workspaceSlug: slug,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create task: ${response.statusText}`);
      }

      const result = await response.json();
      const newTaskId = result.data.id;
      setCurrentTaskId(newTaskId);

      const newUrl = `/w/${slug}/task/${newTaskId}`;
      // this updates the URL WITHOUT reloading the page
      window.history.replaceState({}, "", newUrl);

      setStarted(true);
      await sendMessage(msg, undefined, { taskId: newTaskId });
    } else {
      setStarted(true);
      await sendMessage(msg);
    }

    // Remove the auto-reply since we'll get real-time messages via SSE
    // setTimeout(() => {
    //   const msg = assistantMessage();
    //   setMessages((prev) => [...prev, msg]);
    // }, 1000);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    await sendMessage(input.trim());
    setInput("");
  };

  const sendMessage = async (
    messageText: string,
    artifact?: Artifact,
    options?: {
      taskId?: string;
      replyId?: string;
      webhook?: string;
    }
  ) => {
    if (isLoading) return;

    // Only create a chat message if there's actual text content (not just whitespace)
    // For artifact-only messages (like debug), skip creating the empty chat bubble
    const hasRealMessage = messageText && messageText.trim().length > 0;
    
    let newMessage: ChatMessage | null = null;
    if (hasRealMessage) {
      newMessage = createChatMessage({
        id: generateUniqueId(),
        message: messageText,
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        replyId: options?.replyId,
        artifacts: artifact ? [{ ...artifact, messageId: generateUniqueId() }] : undefined,
      });
      setMessages((msgs) => [...msgs, newMessage]);
    }
    setIsLoading(true);

    // console.log("Sending message:", messageText, options);

    try {
      const body: { [k: string]: unknown } = {
        taskId: options?.taskId || currentTaskId,
        message: messageText,
        contextTags: [],
        ...(options?.replyId && { replyId: options.replyId }),
        ...(options?.webhook && { webhook: options.webhook }),
        ...(artifact && { artifacts: [artifact] }),
      };
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to send message");
      }

      // Update the temporary message status if a message was created
      if (newMessage) {
        setMessages((msgs) =>
          msgs.map((msg) =>
            msg.id === newMessage.id ? { ...msg, status: ChatStatus.SENT } : msg
          )
        );
      }
    } catch (error) {
      console.error("Error sending message:", error);

      // Update message status to ERROR if a message was created
      if (newMessage) {
        setMessages((msgs) =>
          msgs.map((msg) =>
            msg.id === newMessage.id ? { ...msg, status: ChatStatus.ERROR } : msg
          )
        );
      }

      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleArtifactAction = async (
    messageId: string,
    action: Option,
    webhook: string
  ) => {
    // console.log("Action triggered:", action);

    // Find the original message that contains artifacts
    const originalMessage = messages.find((msg) => msg.id === messageId);

    if (originalMessage) {
      // Send the artifact action response to the backend
      await sendMessage(action.optionResponse, undefined, {
        replyId: originalMessage.id,
        webhook: webhook,
      });
    }
  };

  const handleRemoveDebugAttachment = (messageId: string, artifactId: string) => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              artifacts: msg.artifacts?.filter((artifact) => artifact.id !== artifactId)
            }
          : msg
      )
    );
  };

  // Separate artifacts by type
  const allArtifacts = messages.flatMap((msg) => msg.artifacts || []);
  const codeArtifacts = allArtifacts.filter((a) => a.type === "CODE");
  const browserArtifacts = allArtifacts.filter((a) => a.type === "BROWSER");
  const hasNonFormArtifacts =
    codeArtifacts.length > 0 || browserArtifacts.length > 0;

  const availableTabs: ArtifactType[] = useMemo(() => {
    const tabs: ArtifactType[] = [];
    if (codeArtifacts.length > 0) tabs.push("CODE");
    if (browserArtifacts.length > 0) tabs.push("BROWSER");
    return tabs;
  }, [codeArtifacts.length, browserArtifacts.length]);

  // Auto-select first tab when artifacts become available
  useEffect(() => {
    if (availableTabs.length > 0 && !activeTab) {
      setActiveTab(availableTabs[0]);
    }
  }, [availableTabs, activeTab]);

  return (
    <AnimatePresence mode="wait">
      {!started ? (
        <motion.div
          key="start"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.6, ease: [0.4, 0.0, 0.2, 1] }}
        >
          <TaskStartInput onStart={handleStart} />
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.4, ease: [0.4, 0.0, 0.2, 1] }}
          className="h-[92vh] md:h-[97vh] flex gap-4"
        >
          {/* Main Chat Area */}
          <motion.div
            className="flex flex-col bg-background rounded-xl border shadow-sm overflow-hidden"
            layout
            initial={{ width: "100%" }}
            animate={{ width: hasNonFormArtifacts ? "50%" : "100%" }}
            transition={{
              duration: 0.6,
              ease: [0.4, 0.0, 0.2, 1],
            }}
          >
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40">
              {messages
                .filter((msg) => !msg.replyId) // Hide messages that are replies
                .map((msg) => {
                  // Find if this message has been replied to
                  const replyMessage = messages.find(
                    (m) => m.replyId === msg.id
                  );

                  return (
                    <motion.div
                      key={msg.id}
                      className="space-y-3"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                    >
                      <div
                        className={`flex items-end gap-3 ${msg.role === "USER" ? "justify-end" : "justify-start"}`}
                      >
                        {msg.role === "ASSISTANT" && (
                          <Avatar>
                            <AvatarImage src="" alt="Assistant" />
                            <AvatarFallback>A</AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={`px-4 py-2 rounded-xl text-sm max-w-xs shadow-sm ${
                            msg.role === "USER"
                              ? "bg-primary text-primary-foreground rounded-br-none"
                              : "bg-background text-foreground rounded-bl-none border"
                          }`}
                        >
                          {msg.message}
                        </div>
                        {msg.role === "USER" && (
                          <Avatar>
                            <AvatarImage src="" alt="You" />
                            <AvatarFallback>Y</AvatarFallback>
                          </Avatar>
                        )}
                      </div>

                      {/* Only Form Artifacts in Chat */}
                      {msg.artifacts
                        ?.filter((a) => a.type === "FORM")
                        .map((artifact) => {
                          // Find which option was selected by matching replyMessage content with optionResponse
                          let selectedOption = null;
                          if (replyMessage && artifact.content) {
                            const formContent = artifact.content as FormContent;
                            selectedOption = formContent.options?.find(
                              (option: Option) =>
                                option.optionResponse === replyMessage.message
                            );
                          }

                          return (
                            <div
                              key={artifact.id}
                              className={`flex ${msg.role === "USER" ? "justify-end" : "justify-start"}`}
                            >
                              <div className="max-w-md">
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: 0.2 }}
                                >
                                  <FormArtifact
                                    messageId={msg.id}
                                    artifact={artifact}
                                    onAction={handleArtifactAction}
                                    selectedOption={selectedOption}
                                    isDisabled={!!replyMessage}
                                  />
                                </motion.div>
                              </div>
                            </div>
                          );
                        })}

                      {/* Debug Report Artifacts */}
                      {msg.artifacts
                        ?.filter((a) => a.type === "BUG_REPORT")
                        .map((artifact) => (
                          <div
                            key={artifact.id}
                            className={`flex ${msg.role === "USER" ? "justify-end" : "justify-start"}`}
                          >
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.2 }}
                            >
                              <DebugAttachment
                                artifact={artifact}
                                onRemove={() => handleRemoveDebugAttachment(msg.id, artifact.id)}
                              />
                            </motion.div>
                          </div>
                        ))}
                    </motion.div>
                  );
                })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form
              onSubmit={handleSend}
              className="flex gap-2 px-6 py-4 border-t bg-background sticky bottom-0 z-10"
            >
              <Input
                placeholder="Type your message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1"
                autoFocus
              />
              <Button type="submit" disabled={!input.trim() || isLoading}>
                {isLoading ? "Sending..." : "Send"}
              </Button>
              {/* Connection status indicator */}
              <div className="flex items-center ml-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? "bg-green-500" : "bg-gray-400"
                  }`}
                  title={isConnected ? "Connected" : "Disconnected"}
                />
              </div>
            </form>
          </motion.div>

          {/* Artifacts Panel */}
          <AnimatePresence>
            {hasNonFormArtifacts && (
              <motion.div
                layout
                initial={{ opacity: 0, x: 100, width: 0 }}
                animate={{ opacity: 1, x: 0, width: "50%" }}
                exit={{ opacity: 0, x: 100, width: 0 }}
                transition={{
                  duration: 0.4,
                  ease: [0.4, 0.0, 0.2, 1],
                }}
                className="bg-background rounded-xl border shadow-sm overflow-hidden flex flex-col"
              >
                <Tabs
                  value={activeTab as string}
                  className="flex-1 flex flex-col min-h-0"
                  onValueChange={(value) => {
                    setActiveTab(value as ArtifactType);
                  }}
                >
                  <motion.div
                    className="px-6 py-4 border-b bg-background/80 backdrop-blur"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                  >
                    <TabsList
                      className={`grid w-full grid-cols-${availableTabs.length}`}
                    >
                      {codeArtifacts.length > 0 && (
                        <TabsTrigger value="CODE">Code</TabsTrigger>
                      )}
                      {browserArtifacts.length > 0 && (
                        <TabsTrigger value="BROWSER">Live Preview</TabsTrigger>
                      )}
                    </TabsList>
                  </motion.div>

                  <motion.div
                    className="flex-1 overflow-hidden min-h-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                  >
                    {codeArtifacts.length > 0 && (
                      <TabsContent
                        value="CODE"
                        className="h-full mt-0"
                        forceMount
                        hidden={activeTab !== "CODE"}
                      >
                        <CodeArtifactPanel artifacts={codeArtifacts} />
                      </TabsContent>
                    )}
                    {browserArtifacts.length > 0 && (
                      <TabsContent
                        value="BROWSER"
                        className="h-full mt-0"
                        forceMount
                        hidden={activeTab !== "BROWSER"}
                      >
                        <BrowserArtifactPanel 
                          artifacts={browserArtifacts} 
                          onDebugMessage={(message: string, debugArtifact?: Artifact) => 
                            sendMessage(message, debugArtifact)
                          }
                        />
                      </TabsContent>
                    )}
                  </motion.div>
                </Tabs>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
