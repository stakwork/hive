"use client";

import { useState } from "react";
import { LearnChatArea } from "./LearnChatArea";
import { LearnSidebar } from "./LearnSidebar";
import type { LearnMessage } from "@/types/learn";

interface LearnChatProps {
  workspaceSlug: string;
}

export function LearnChat({ workspaceSlug }: LearnChatProps) {
  const [mode, setMode] = useState<"learn" | "chat">("learn");
  const [messages, setMessages] = useState<LearnMessage[]>([
    {
      id: "1",
      content:
        "Hello! I'm your learning assistant. I can help you understand concepts, explain code, answer questions, and guide you through learning new skills. What would you like to learn about today?",
      role: "assistant",
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentInput, setCurrentInput] = useState("");

  const handleSend = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: LearnMessage = {
      id: Date.now().toString(),
      content: content.trim(),
      role: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Choose API endpoint based on mode
      const apiEndpoint =
        mode === "chat"
          ? `/api/ask/quick?question=${encodeURIComponent(content.trim())}&workspace=${encodeURIComponent(workspaceSlug)}`
          : `/api/ask?question=${encodeURIComponent(content.trim())}&workspace=${encodeURIComponent(workspaceSlug)}`;

      const response = await fetch(apiEndpoint);

      console.log("🌐 Response details:", {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: response.body,
        bodyUsed: response.bodyUsed,
        url: response.url,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (mode === "chat") {
        console.log("🚀 Starting chat mode streaming...");

        // Handle streaming response for chat mode
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        console.log("✅ Got response reader");

        const assistantMessage: LearnMessage = {
          id: (Date.now() + 1).toString(),
          content: "",
          role: "assistant",
          timestamp: new Date(),
        };

        // Add the empty assistant message first
        setMessages((prev) => [...prev, assistantMessage]);
        console.log("📝 Added empty assistant message with ID:", assistantMessage.id);

        const decoder = new TextDecoder();
        let done = false;
        let buffer = "";
        let chunkCount = 0;

        try {
          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            chunkCount++;

            console.log(`📦 Chunk ${chunkCount}:`, {
              hasValue: !!value,
              valueLength: value?.length,
              done: readerDone,
            });

            if (value) {
              const decodedChunk = decoder.decode(value, { stream: true });
              console.log(`🔤 Decoded chunk ${chunkCount}:`, decodedChunk);

              buffer += decodedChunk;
              const lines = buffer.split("\n");

              // Keep the last incomplete line in buffer
              buffer = lines.pop() || "";
              console.log(`📄 Processing ${lines.length} lines, buffer remaining:`, buffer);

              for (const line of lines) {
                if (line.trim() === "") {
                  console.log("⏭️ Skipping empty line");
                  continue;
                }

                console.log("🔍 Processing line:", JSON.stringify(line));

                try {
                  // Handle different streaming formats
                  if (line.startsWith("0:")) {
                    console.log("✅ AI SDK format detected (0:)");
                    const text = line.slice(2);
                    console.log("📝 Adding text:", JSON.stringify(text));
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id ? { ...msg, content: msg.content + text } : msg,
                      ),
                    );
                  } else if (line.startsWith("data: ")) {
                    console.log("✅ Server-sent events format detected (data:)");
                    const data = line.slice(6);
                    if (data === "[DONE]") {
                      console.log("🏁 Stream complete");
                      break;
                    }

                    try {
                      const parsed = JSON.parse(data);
                      console.log("📊 Parsed JSON:", parsed);
                      if (parsed.choices?.[0]?.delta?.content) {
                        const text = parsed.choices[0].delta.content;
                        console.log("📝 Adding text from choices:", JSON.stringify(text));
                        setMessages((prev) =>
                          prev.map((msg) =>
                            msg.id === assistantMessage.id ? { ...msg, content: msg.content + text } : msg,
                          ),
                        );
                      }
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    } catch (e) {
                      console.log("⚠️ JSON parse failed, treating as plain text:", data);
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessage.id ? { ...msg, content: msg.content + data } : msg,
                        ),
                      );
                    }
                  } else {
                    console.log("📝 Plain text streaming - adding line directly");
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id ? { ...msg, content: msg.content + line } : msg,
                      ),
                    );
                  }
                } catch (e) {
                  console.error("❌ Error parsing streaming line:", line, e);
                }
              }

              // Handle any remaining text in buffer that doesn't end with newline
              if (buffer && !done) {
                console.log("📝 Adding remaining buffer text:", JSON.stringify(buffer));
                setMessages((prev) =>
                  prev.map((msg) => (msg.id === assistantMessage.id ? { ...msg, content: msg.content + buffer } : msg)),
                );
                buffer = ""; // Clear buffer after adding
              }
            }
          }

          console.log("🏁 Stream reading complete. Total chunks:", chunkCount);
        } catch (error) {
          console.error("❌ Error reading stream:", error);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessage.id
                ? { ...msg, content: msg.content + "\n\n[Streaming error occurred]" }
                : msg,
            ),
          );
        } finally {
          reader.releaseLock();
          console.log("🔓 Reader released");
        }
      } else {
        // Handle regular JSON response for learn mode
        const data = await response.json();

        const assistantMessage: LearnMessage = {
          id: (Date.now() + 1).toString(),
          content: data.answer || data.message || "I apologize, but I couldn't generate a response at this time.",
          role: "assistant",
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error("Error calling ask API:", error);
      const errorMessage: LearnMessage = {
        id: (Date.now() + 1).toString(),
        content: "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        role: "assistant",
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div className="relative h-full">
      <div className="h-full pr-80">
        <LearnChatArea
          messages={messages}
          onSend={handleSend}
          isLoading={isLoading}
          onInputChange={setCurrentInput}
          mode={mode}
          onModeChange={setMode}
        />
      </div>
      <div className="fixed top-1 right-1 h-full">
        <LearnSidebar
          workspaceSlug={workspaceSlug}
          onPromptClick={handlePromptClick}
          currentQuestion={currentInput.trim() || undefined}
        />
      </div>
    </div>
  );
}
