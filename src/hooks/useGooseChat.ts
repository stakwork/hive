"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// Types for Goose server messages
export interface GooseMessage {
  type:
    | "response"
    | "tool_request"
    | "tool_response"
    | "tool_confirmation"
    | "thinking"
    | "context_exceeded"
    | "cancelled"
    | "complete"
    | "error";
  content?: string;
  role?: "user" | "assistant";
  timestamp?: number;
  session_id?: string;
  id?: string;
  tool_name?: string;
  arguments?: Record<string, any>;
  is_error?: boolean;
  result?: any;
  message?: string;
}

export interface GooseChatState {
  isConnected: boolean;
  isProcessing: boolean;
  messages: GooseMessage[];
  currentStreamingMessage: GooseMessage | null;
}

export interface UseGooseChatReturn extends GooseChatState {
  sendMessage: (content: string) => void;
  cancelOperation: () => void;
  connect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
}

export function useGooseChat(baseUrl: string): UseGooseChatReturn {
  const [state, setState] = useState<GooseChatState>({
    isConnected: false,
    isProcessing: false,
    messages: [],
    currentStreamingMessage: null,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string>("");
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Generate session ID using timestamp format (yyyymmdd_hhmmss)
  const generateSessionId = useCallback(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    const second = String(now.getSeconds()).padStart(2, "0");

    return `${year}${month}${day}_${hour}${minute}${second}`;
  }, []);

  // Initialize session ID
  useEffect(() => {
    sessionIdRef.current = generateSessionId();
  }, [generateSessionId]);

  // Add message to chat
  const addMessage = useCallback((message: GooseMessage) => {
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, message],
    }));
  }, []);

  // Remove thinking indicator
  const removeThinkingIndicator = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: prev.messages.filter((msg) => msg.type !== "thinking"),
    }));
  }, []);

  // Handle server messages
  const handleServerMessage = useCallback(
    (data: GooseMessage) => {
      switch (data.type) {
        case "response":
          // Handle streaming responses
          setState((prev) => {
            if (!prev.currentStreamingMessage) {
              // Create new streaming message
              return {
                ...prev,
                currentStreamingMessage: data,
                messages: [...prev.messages, data],
              };
            } else {
              // Append to existing streaming message
              const updatedStreamingMessage = {
                ...prev.currentStreamingMessage,
                content:
                  (prev.currentStreamingMessage.content || "") +
                  (data.content || ""),
              };

              // Update the message in the messages array
              const updatedMessages = prev.messages.map((msg) =>
                msg === prev.currentStreamingMessage
                  ? updatedStreamingMessage
                  : msg,
              );

              return {
                ...prev,
                currentStreamingMessage: updatedStreamingMessage,
                messages: updatedMessages,
              };
            }
          });
          removeThinkingIndicator();
          break;

        case "tool_request":
          removeThinkingIndicator();
          setState((prev) => ({
            ...prev,
            currentStreamingMessage: null, // Reset streaming for tool
          }));
          addMessage(data);
          break;

        case "tool_response":
          addMessage(data);
          setState((prev) => ({
            ...prev,
            currentStreamingMessage: null, // Reset streaming for next response
          }));
          break;

        case "tool_confirmation":
          addMessage(data);
          break;

        case "thinking":
          // Add thinking indicator
          addMessage(data);
          break;

        case "context_exceeded":
          addMessage(data);
          break;

        case "cancelled":
          removeThinkingIndicator();
          setState((prev) => ({
            ...prev,
            isProcessing: false,
          }));
          addMessage(data);
          break;

        case "complete":
          removeThinkingIndicator();
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            currentStreamingMessage: null,
          }));
          break;

        case "error":
          removeThinkingIndicator();
          setState((prev) => ({
            ...prev,
            isProcessing: false,
          }));
          addMessage(data);
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    },
    [addMessage, removeThinkingIndicator],
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${baseUrl.replace(/^https?:\/\//, "")}/ws`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Goose WebSocket connected");
      setState((prev) => ({ ...prev, isConnected: true }));

      // Clear any existing reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const data: GooseMessage = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (e) {
        console.error("Failed to parse Goose message:", e);
      }
    };

    socket.onclose = () => {
      console.log("Goose WebSocket disconnected");
      setState((prev) => ({ ...prev, isConnected: false }));

      // Attempt to reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    socket.onerror = (error) => {
      console.error("Goose WebSocket error:", error);
    };
  }, [baseUrl, handleServerMessage]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setState((prev) => ({ ...prev, isConnected: false }));
  }, []);

  // Send message
  const sendMessage = useCallback(
    (content: string) => {
      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        console.error("WebSocket not connected");
        return;
      }

      // Add user message to chat
      const userMessage: GooseMessage = {
        type: "response",
        content,
        role: "user",
        timestamp: Date.now(),
      };
      addMessage(userMessage);

      // Set processing state
      setState((prev) => ({ ...prev, isProcessing: true }));

      // Send message through WebSocket
      socketRef.current.send(
        JSON.stringify({
          type: "message",
          content,
          session_id: sessionIdRef.current,
          timestamp: Date.now(),
        }),
      );
    },
    [addMessage],
  );

  // Cancel operation
  const cancelOperation = useCallback(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "cancel",
        session_id: sessionIdRef.current,
      }),
    );
  }, []);

  // Clear messages
  const clearMessages = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: [],
      currentStreamingMessage: null,
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    sendMessage,
    cancelOperation,
    connect,
    disconnect,
    clearMessages,
  };
}
