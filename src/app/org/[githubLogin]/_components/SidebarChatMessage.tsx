"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";

/**
 * Sidebar-flavored chat bubble. Forked from
 * `@/components/dashboard/DashboardChat/ChatMessage` because that one
 * is centered (`justify-center`) and bubble-capped at 600px — both
 * fine for the dashboard's bottom-anchored overlay, both wrong in a
 * 384px sidebar where we want user messages right-aligned, assistant
 * messages left-aligned, and bubbles to be narrower than the column.
 *
 * No `pointer-events-auto` (the parent column is fully interactive
 * already) and no `max-w-[600px]` (we cap user bubbles to ~85% of
 * the column instead).
 */
interface SidebarChatMessageProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  };
  isStreaming?: boolean;
}

export function SidebarChatMessage({
  message,
  isStreaming = false,
}: SidebarChatMessageProps) {
  const isUser = message.role === "user";

  if (!message.content.trim()) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`${
          isUser ? "max-w-[85%]" : "w-full"
        }`}
      >
        <div
          className={`rounded-2xl px-3 py-2 shadow-sm ${
            isUser
              ? "bg-primary text-primary-foreground inline-block"
              : "bg-muted/40"
          }`}
        >
          {isStreaming ? (
            <div
              className={`text-sm whitespace-pre-wrap break-words ${
                isUser ? "text-primary-foreground" : "text-foreground/90"
              }`}
            >
              {message.content}
            </div>
          ) : (
            <div
              className={`prose prose-sm max-w-none break-words ${
                isUser
                  ? "[&>*]:!text-primary-foreground [&_*]:!text-primary-foreground"
                  : "dark:prose-invert [&>*]:!text-foreground/90 [&_*]:!text-foreground/90"
              }`}
            >
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
