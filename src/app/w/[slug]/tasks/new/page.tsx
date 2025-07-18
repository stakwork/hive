"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRef, useEffect, useState } from "react";
import {
    ArrowUp,
    Code,
    Monitor,
    Copy,
    Check,
    RefreshCw,
    ExternalLink,
    FileText,
    GitBranch,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-json";
import "prismjs/themes/prism.css";

// Types
interface ArtifactAction {
    action_type: "chat" | "button";
    option_label: string;
    option_response: string;
    webhook: string;
}

interface ActionArtifact {
    id: string;
    type: "action";
    content: {
        actionText: string;
        options: ArtifactAction[];
    };
}

interface TextArtifact {
    id: string;
    messageId: string;
    type: "text";
    content: {
        text_type: "code" | "markdown";
        content: string;
        code_metadata?: {
            File: string;
            Change: string;
            Action: string;
        };
    };
}

interface VisualArtifact {
    id: string;
    type: "visual";
    content: {
        visual_type: "screen";
        url: string;
    };
}

type Artifact = ActionArtifact | TextArtifact | VisualArtifact;

interface Message {
    id: string;
    user: { name: string; avatar: string; fallback: string };
    text: string;
    self: boolean;
    artifacts?: Artifact[];
}

// Syntax highlighting component
function SyntaxHighlighter({
    code,
    language,
}: {
    code: string;
    language: string;
}) {
    const codeRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (codeRef.current) {
            Prism.highlightElement(codeRef.current);
        }
    }, [code, language]);

    return (
        <pre className="text-sm bg-background/50 p-4 rounded border overflow-x-auto">
            <code ref={codeRef} className={`language-${language}`}>
                {code}
            </code>
        </pre>
    );
}

// Get language from file extension
const getLanguageFromFile = (filename: string): string => {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mapping: Record<string, string> = {
        js: "javascript",
        jsx: "jsx",
        ts: "typescript",
        tsx: "tsx",
        py: "python",
        rb: "ruby",
        css: "css",
        html: "html",
        json: "json",
        md: "markdown",
    };
    return mapping[ext || ""] || "text";
};

// Get action icon
const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
        case "create":
            return <FileText className="w-4 h-4 text-green-500" />;
        case "update":
            return <GitBranch className="w-4 h-4 text-blue-500" />;
        case "delete":
            return <FileText className="w-4 h-4 text-red-500" />;
        default:
            return <FileText className="w-4 h-4 text-gray-500" />;
    }
};

// Artifact Components
function ActionArtifact({
    artifact,
    onAction,
}: {
    artifact: ActionArtifact;
    onAction: (action: ArtifactAction, response?: string) => void;
}) {
    const handleSubmit = (action: ArtifactAction) => {
        onAction(action);
    };

    return (
        <Card className="p-4 bg-card border rounded-lg">
            <p className="text-sm font-medium mb-3">
                {artifact.content.actionText}
            </p>
            <div className="space-y-2">
                {artifact.content.options.map((option, index) => (
                    <Button
                        key={index}
                        variant="outline"
                        size="sm"
                        onClick={() => handleSubmit(option)}
                        className="w-full justify-start"
                    >
                        {option.option_label}
                    </Button>
                ))}
            </div>
        </Card>
    );
}

function TextArtifactPanel({ artifacts }: { artifacts: TextArtifact[] }) {
    const [copied, setCopied] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState(0);

    const handleCopy = async (content: string, id: string) => {
        await navigator.clipboard.writeText(content);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    if (artifacts.length === 0) return null;

    return (
        <div className="h-full flex flex-col">
            {artifacts.length > 1 && (
                <div className="border-b bg-muted/20">
                    <div className="flex overflow-x-auto">
                        {artifacts.map((artifact, index) => (
                            <button
                                key={artifact.id}
                                onClick={() => setActiveTab(index)}
                                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                                    activeTab === index
                                        ? "border-primary text-primary bg-background"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {artifact.content.code_metadata?.File
                                    ? artifact.content.code_metadata.File.split(
                                          "/"
                                      ).pop()
                                    : `Code ${index + 1}`}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-hidden">
                {artifacts.map((artifact, index) => (
                    <div
                        key={artifact.id}
                        className={`h-full ${activeTab === index ? "block" : "hidden"}`}
                    >
                        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                            <div className="flex items-center gap-2 min-w-0">
                                <Code className="w-4 h-4 flex-shrink-0" />
                                {artifact.content.code_metadata ? (
                                    <div className="flex items-center gap-2 min-w-0">
                                        {getActionIcon(
                                            artifact.content.code_metadata
                                                .Action
                                        )}
                                        <span className="text-sm font-medium truncate">
                                            {
                                                artifact.content.code_metadata
                                                    .File
                                            }
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-sm font-medium">
                                        Code
                                    </span>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    handleCopy(
                                        artifact.content.content,
                                        artifact.id
                                    )
                                }
                                className="h-8 w-8 p-0 flex-shrink-0"
                            >
                                {copied === artifact.id ? (
                                    <Check className="w-4 h-4" />
                                ) : (
                                    <Copy className="w-4 h-4" />
                                )}
                            </Button>
                        </div>

                        {artifact.content.code_metadata && (
                            <div className="px-4 py-2 bg-muted/20 border-b text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span className="font-medium">Change:</span>
                                    <span>
                                        {artifact.content.code_metadata.Change}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="p-4 h-full overflow-auto">
                            <SyntaxHighlighter
                                code={artifact.content.content}
                                language={
                                    artifact.content.code_metadata?.File
                                        ? getLanguageFromFile(
                                              artifact.content.code_metadata
                                                  .File
                                          )
                                        : "text"
                                }
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function VisualArtifactPanel({ artifacts }: { artifacts: VisualArtifact[] }) {
    const [activeTab, setActiveTab] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleRefresh = () => {
        setRefreshKey((prev) => prev + 1);
    };

    const handleTabOut = (url: string) => {
        window.open(url, "_blank");
    };

    if (artifacts.length === 0) return null;

    return (
        <div className="h-full flex flex-col">
            {artifacts.length > 1 && (
                <div className="border-b bg-muted/20">
                    <div className="flex overflow-x-auto">
                        {artifacts.map((artifact, index) => (
                            <button
                                key={artifact.id}
                                onClick={() => setActiveTab(index)}
                                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                                    activeTab === index
                                        ? "border-primary text-primary bg-background"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Preview {index + 1}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-hidden">
                {artifacts.map((artifact, index) => (
                    <div
                        key={artifact.id}
                        className={`h-full flex flex-col ${activeTab === index ? "block" : "hidden"}`}
                    >
                        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                            <div className="flex items-center gap-2 min-w-0">
                                <Monitor className="w-4 h-4 flex-shrink-0" />
                                <span className="text-sm font-medium truncate">
                                    {artifact.content.url}
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        handleTabOut(artifact.content.url)
                                    }
                                    className="h-8 w-8 p-0"
                                    title="Open in new tab"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleRefresh}
                                    className="h-8 w-8 p-0"
                                    title="Refresh"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <iframe
                                key={`${artifact.id}-${refreshKey}`}
                                src={artifact.content.url}
                                className="w-full h-full border-0"
                                title={`Live Preview ${index + 1}`}
                            />
                        </div>
                    </div>
                ))}
            </div>
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
        <div className="flex flex-col items-center justify-center w-full h-[80vh] md:h-[90vh] bg-background">
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
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [started, setStarted] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (started) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, started]);

   const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        const newMessage: Message = {
            id: Date.now().toString(),
            user: { name: "You", avatar: "", fallback: "Y" },
            text: input,
            self: true,
        };

        setMessages((msgs) => [...msgs, newMessage]);
        setInput("");
    };

    const handleStart = (task: string) => {
        setStarted(true);
        const userMessage: Message = {
            id: Date.now().toString(),
            user: { name: "You", avatar: "", fallback: "Y" },
            text: task,
            self: true,
        };
        setMessages([userMessage]);

        // Auto-reply after a short delay
        setTimeout(() => {
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                user: { name: "Assistant", avatar: "", fallback: "A" },
                text: "I'll help you build a connection leak monitor for your Aurora Postgres database. Let me create the necessary files and configuration.",
                self: false,
                artifacts: [
                    {
                        id: "action-confirm",
                        type: "action",
                        content: {
                            actionText:
                                "Here's my plan to implement the connection leak monitor:",
                            options: [
                                {
                                    action_type: "button",
                                    option_label: "✓ Confirm Plan",
                                    option_response: "confirmed",
                                    webhook:
                                        "https://stakwork.com/api/chat/confirm",
                                },
                                {
                                    action_type: "button",
                                    option_label: "✗ Modify Plan",
                                    option_response: "modify",
                                    webhook:
                                        "https://stakwork.com/api/chat/modify",
                                },
                            ],
                        },
                    },
                ],
            };
            setMessages((prev) => [...prev, assistantMessage]);
        }, 1000);
    };

    const handleArtifactAction = (
        action: ArtifactAction,
        response?: string
    ) => {
        console.log("Action triggered:", action, response);

        if (action.option_response === "confirmed") {
            // Remove the action artifact and add the code artifacts
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.artifacts?.some((a) => a.id === "action-confirm")
                        ? {
                              ...msg,
                              artifacts: msg.artifacts?.filter(
                                  (a) => a.id !== "action-confirm"
                              ),
                          }
                        : msg
                )
            );

            // Add new message with artifacts after a short delay
            setTimeout(() => {
                const codeMessage: Message = {
                    id: (Date.now() + 2).toString(),
                    user: { name: "Assistant", avatar: "", fallback: "A" },
                    text: "Perfect! I've created the connection leak monitor implementation. Here's what I've built:",
                    self: false,
                    artifacts: [
                        {
                            id: "550e8400-e29b-41d4-a716-446655440123",
                            messageId: "msg_123456",
                            type: "text",
                            content: {
                                text_type: "code",
                                content: `class ConnectionLeakMonitor
  def initialize(pool_size: 5, threshold: 0.8)
    @pool_size = pool_size
    @threshold = threshold
    @active_connections = 0
    @leaked_connections = []
    @logger = Rails.logger
  end

  def monitor_connection_pool
    current_usage = @active_connections.to_f / @pool_size
    
    if current_usage > @threshold
      @logger.warn "Connection pool usage at #{(current_usage * 100).round(2)}%"
      detect_leaks
    end
    
    log_metrics
  end

  def track_connection(connection)
    @active_connections += 1
    @logger.debug "Active connections: #{@active_connections}/#{@pool_size}"
  end

  def release_connection(connection)
    @active_connections -= 1 if @active_connections > 0
    @logger.debug "Active connections: #{@active_connections}/#{@pool_size}"
  end

  private

  def detect_leaks
    @leaked_connections = find_leaked_connections
    @leaked_connections.each do |conn|
      @logger.error "Closing leaked connection: #{conn.object_id}"
      conn.close
    end
  end

  def find_leaked_connections
    # Implementation would check for connections that haven't been 
    # returned to the pool within a reasonable timeframe
    []
  end

  def log_metrics
    usage_percent = (@active_connections.to_f / @pool_size * 100).round(2)
    @logger.info "Pool usage: #{usage_percent}% (#{@active_connections}/#{@pool_size})"
  end
end`,
                                code_metadata: {
                                    File: "stakwork/senza-lnd/lib/connection_leak_monitor.rb",
                                    Change: "Create main connection leak monitor class that tracks Aurora Postgres connection pool metrics and detects leaks",
                                    Action: "create",
                                },
                            },
                        },
                        {
                            id: "550e8400-e29b-41d4-a716-446655440124",
                            messageId: "msg_123457",
                            type: "text",
                            content: {
                                text_type: "code",
                                content: `{
  "database": {
    "adapter": "postgresql",
    "host": "aurora-cluster.cluster-xyz.us-east-1.rds.amazonaws.com",
    "port": 5432,
    "database": "senza_lnd_production",
    "pool": {
      "size": 10,
      "timeout": 5000,
      "checkout_timeout": 5000,
      "reaping_frequency": 60
    },
    "leak_detection": {
      "enabled": true,
      "threshold": 0.8,
      "check_interval": 30000,
      "max_connection_age": 300000
    }
  },
  "monitoring": {
    "metrics_enabled": true,
    "alert_threshold": 0.9,
    "log_level": "info",
    "cloudwatch_enabled": true
  }
}`,
                                code_metadata: {
                                    File: "stakwork/senza-lnd/config/database.json",
                                    Change: "Add Aurora Postgres database configuration with connection leak monitoring settings",
                                    Action: "create",
                                },
                            },
                        },
                        {
                            id: "preview-1",
                            type: "visual",
                            content: {
                                visual_type: "screen",
                                url: "https://community.sphinx.chat",
                            },
                        },
                    ],
                };

                setMessages((prev) => [...prev, codeMessage]);
            }, 800);
        }
    };

    // Separate artifacts by type
    const allArtifacts = messages.flatMap((msg) => msg.artifacts || []);
    const textArtifacts = allArtifacts.filter(
        (a) => a.type === "text"
    ) as TextArtifact[];
    const visualArtifacts = allArtifacts.filter(
        (a) => a.type === "visual"
    ) as VisualArtifact[];
    const hasNonActionArtifacts =
        textArtifacts.length > 0 || visualArtifacts.length > 0;

    // Count available tabs
    const availableTabs = [];
    if (textArtifacts.length > 0) availableTabs.push("code");
    if (visualArtifacts.length > 0) availableTabs.push("preview");

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
                    transition={{ duration: 0.6, ease: [0.4, 0.0, 0.2, 1] }}
                    className="h-[80vh] md:h-[90vh] flex gap-4"
                >
                    {/* Main Chat Area */}
                    <motion.div
                        className="flex flex-col bg-background rounded-xl border shadow-sm overflow-hidden"
                        initial={{ width: "100%" }}
                        animate={{
                            width: hasNonActionArtifacts ? "50%" : "100%",
                        }}
                        transition={{
                            duration: 0.8,
                            ease: [0.4, 0.0, 0.2, 1],
                            layout: {
                                type: "spring",
                                stiffness: 100,
                                damping: 20,
                            },
                        }}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b bg-background/80 backdrop-blur sticky top-0 z-10">
                            <h2 className="text-2xl font-semibold">Hive</h2>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 bg-muted/40">
                            {messages.map((msg) => (
                                <motion.div
                                    key={msg.id}
                                    className="space-y-3"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    <div
                                        className={`flex items-end gap-3 ${msg.self ? "justify-end" : "justify-start"}`}
                                    >
                                        {!msg.self && (
                                            <Avatar>
                                                <AvatarImage
                                                    src={msg.user.avatar}
                                                    alt={msg.user.name}
                                                />
                                                <AvatarFallback>
                                                    {msg.user.fallback}
                                                </AvatarFallback>
                                            </Avatar>
                                        )}
                                        <div
                                            className={`px-4 py-2 rounded-xl text-sm max-w-xs shadow-sm ${
                                                msg.self
                                                    ? "bg-primary text-primary-foreground rounded-br-none"
                                                    : "bg-background text-foreground rounded-bl-none border"
                                            }`}
                                        >
                                            {msg.text}
                                        </div>
                                        {msg.self && (
                                            <Avatar>
                                                <AvatarImage
                                                    src={msg.user.avatar}
                                                    alt={msg.user.name}
                                                />
                                                <AvatarFallback>
                                                    {msg.user.fallback}
                                                </AvatarFallback>
                                            </Avatar>
                                        )}
                                    </div>

                                    {/* Only Action Artifacts in Chat */}
                                    {msg.artifacts
                                        ?.filter((a) => a.type === "action")
                                        .map((artifact) => (
                                            <div
                                                key={artifact.id}
                                                className={`flex ${msg.self ? "justify-end" : "justify-start"}`}
                                            >
                                                <div className="max-w-md">
                                                    <motion.div
                                                        initial={{
                                                            opacity: 0,
                                                            y: 10,
                                                        }}
                                                        animate={{
                                                            opacity: 1,
                                                            y: 0,
                                                        }}
                                                        transition={{
                                                            delay: 0.2,
                                                        }}
                                                    >
                                                        <ActionArtifact
                                                            artifact={
                                                                artifact as ActionArtifact
                                                            }
                                                            onAction={
                                                                handleArtifactAction
                                                            }
                                                        />
                                                    </motion.div>
                                                </div>
                                            </div>
                                        ))}
                                </motion.div>
                            ))}
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
                            <Button type="submit" disabled={!input.trim()}>
                                Send
                            </Button>
                        </form>
                    </motion.div>

                    {/* Artifacts Panel */}
                    <AnimatePresence>
                        {hasNonActionArtifacts && (
                            <motion.div
                                initial={{ opacity: 0, x: 100, width: 0 }}
                                animate={{ opacity: 1, x: 0, width: "50%" }}
                                exit={{ opacity: 0, x: 100, width: 0 }}
                                transition={{
                                    duration: 0.8,
                                    ease: [0.4, 0.0, 0.2, 1],
                                    layout: {
                                        type: "spring",
                                        stiffness: 100,
                                        damping: 20,
                                    },
                                }}
                                className="bg-background rounded-xl border shadow-sm overflow-hidden flex flex-col"
                            >
                                <Tabs
                                    defaultValue={availableTabs[0]}
                                    className="flex-1 flex flex-col"
                                >
                                    <motion.div
                                        className="px-6 py-4 border-b bg-background/80 backdrop-blur"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.4 }}
                                    >
                                        <TabsList
                                            className={`grid w-full grid-cols-${availableTabs.length}`}
                                        >
                                            {textArtifacts.length > 0 && (
                                                <TabsTrigger value="code">
                                                    Code
                                                </TabsTrigger>
                                            )}
                                            {visualArtifacts.length > 0 && (
                                                <TabsTrigger value="preview">
                                                    Live Preview
                                                </TabsTrigger>
                                            )}
                                        </TabsList>
                                    </motion.div>

                                    <motion.div
                                        className="flex-1 overflow-hidden"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.6 }}
                                    >
                                        {textArtifacts.length > 0 && (
                                            <TabsContent
                                                value="code"
                                                className="h-full mt-0"
                                            >
                                                <TextArtifactPanel
                                                    artifacts={textArtifacts}
                                                />
                                            </TabsContent>
                                        )}
                                        {visualArtifacts.length > 0 && (
                                            <TabsContent
                                                value="preview"
                                                className="h-full mt-0"
                                            >
                                                <VisualArtifactPanel
                                                    artifacts={visualArtifacts}
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
