import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCallback, useState } from "react";
import type { ChatMessage } from "@/lib/chat";
import { ChatRole, ChatStatus } from "@prisma/client";

/**
 * Unit tests for task mode message deduplication and temp id replacement.
 * 
 * These tests verify:
 * 1. handleSSEMessage does not append duplicate messages (same id already exists)
 * 2. Temp id is replaced with real DB id after successful POST
 * 3. Pusher bounce messages are correctly deduplicated after id replacement
 */

describe("Task Message Deduplication", () => {
  describe("handleSSEMessage deduplication guard", () => {
    it("should not append a message if it already exists in state", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([
          {
            id: "msg-123",
            message: "Hello",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            createdAt: new Date(),
          },
        ]);

        const handleSSEMessage = useCallback((message: ChatMessage) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === message.id);
            if (exists) return prev;
            return [...prev, message];
          });
        }, []);

        return { messages, handleSSEMessage };
      });

      const initialLength = result.current.messages.length;

      // Try to add the same message again
      act(() => {
        result.current.handleSSEMessage({
          id: "msg-123",
          message: "Hello",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      // Should not have added a duplicate
      expect(result.current.messages).toHaveLength(initialLength);
      expect(result.current.messages[0].id).toBe("msg-123");
    });

    it("should append a message if it does not exist in state", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([
          {
            id: "msg-123",
            message: "Hello",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            createdAt: new Date(),
          },
        ]);

        const handleSSEMessage = useCallback((message: ChatMessage) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === message.id);
            if (exists) return prev;
            return [...prev, message];
          });
        }, []);

        return { messages, handleSSEMessage };
      });

      const initialLength = result.current.messages.length;

      // Add a new message with different id
      act(() => {
        result.current.handleSSEMessage({
          id: "msg-456",
          message: "World",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      // Should have added the new message
      expect(result.current.messages).toHaveLength(initialLength + 1);
      expect(result.current.messages[1].id).toBe("msg-456");
      expect(result.current.messages[1].message).toBe("World");
    });

    it("should handle multiple duplicate attempts gracefully", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([
          {
            id: "msg-123",
            message: "Hello",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            createdAt: new Date(),
          },
        ]);

        const handleSSEMessage = useCallback((message: ChatMessage) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === message.id);
            if (exists) return prev;
            return [...prev, message];
          });
        }, []);

        return { messages, handleSSEMessage };
      });

      const duplicateMessage = {
        id: "msg-123",
        message: "Hello",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        createdAt: new Date(),
      };

      // Try to add the same message multiple times
      act(() => {
        result.current.handleSSEMessage(duplicateMessage);
        result.current.handleSSEMessage(duplicateMessage);
        result.current.handleSSEMessage(duplicateMessage);
      });

      // Should still have only one message
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("msg-123");
    });
  });

  describe("Temp id replacement after POST", () => {
    it("should replace temp id with real DB id when result.message is returned", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([
          {
            id: "temp_123",
            message: "Hello",
            role: ChatRole.USER,
            status: ChatStatus.SENDING,
            createdAt: new Date(),
          },
        ]);

        const handlePostSuccess = useCallback((tempId: string, realMessage: ChatMessage) => {
          setMessages((msgs) =>
            msgs.map((msg) =>
              msg.id === tempId ? { ...realMessage, status: ChatStatus.SENT } : msg
            )
          );
        }, []);

        return { messages, handlePostSuccess };
      });

      const realMessage: ChatMessage = {
        id: "msg-real-456",
        message: "Hello",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        createdAt: new Date(),
      };

      act(() => {
        result.current.handlePostSuccess("temp_123", realMessage);
      });

      // Should have replaced temp id with real id
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("msg-real-456");
      expect(result.current.messages[0].status).toBe(ChatStatus.SENT);
    });

    it("should update status only when result.message is not returned (fallback)", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([
          {
            id: "temp_123",
            message: "Hello",
            role: ChatRole.USER,
            status: ChatStatus.SENDING,
            createdAt: new Date(),
          },
        ]);

        const handlePostSuccessFallback = useCallback((tempId: string) => {
          setMessages((msgs) =>
            msgs.map((msg) => (msg.id === tempId ? { ...msg, status: ChatStatus.SENT } : msg))
          );
        }, []);

        return { messages, handlePostSuccessFallback };
      });

      act(() => {
        result.current.handlePostSuccessFallback("temp_123");
      });

      // Should keep temp id but update status
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("temp_123");
      expect(result.current.messages[0].status).toBe(ChatStatus.SENT);
    });

    it("should preserve message content when replacing id", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([
          {
            id: "temp_123",
            message: "Hello world",
            role: ChatRole.USER,
            status: ChatStatus.SENDING,
            createdAt: new Date(),
            artifacts: [{ id: "artifact-1", type: "CODE" as const, content: "console.log('test')" }],
          },
        ]);

        const handlePostSuccess = useCallback((tempId: string, realMessage: ChatMessage) => {
          setMessages((msgs) =>
            msgs.map((msg) =>
              msg.id === tempId ? { ...realMessage, status: ChatStatus.SENT } : msg
            )
          );
        }, []);

        return { messages, handlePostSuccess };
      });

      const realMessage: ChatMessage = {
        id: "msg-real-456",
        message: "Hello world",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        createdAt: new Date(),
        artifacts: [{ id: "artifact-1", type: "CODE" as const, content: "console.log('test')" }],
      };

      act(() => {
        result.current.handlePostSuccess("temp_123", realMessage);
      });

      // Should preserve all message properties
      expect(result.current.messages[0].message).toBe("Hello world");
      expect(result.current.messages[0].artifacts).toHaveLength(1);
      expect(result.current.messages[0].artifacts?.[0].content).toBe("console.log('test')");
    });
  });

  describe("End-to-end deduplication scenario", () => {
    it("should prevent duplicate when Pusher bounces sender's own message after id replacement", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([]);

        // Step 1: Add optimistic message with temp id
        const addOptimisticMessage = useCallback((message: ChatMessage) => {
          setMessages((msgs) => [...msgs, message]);
        }, []);

        // Step 2: Replace temp id with real id after POST
        const replaceWithRealId = useCallback((tempId: string, realMessage: ChatMessage) => {
          setMessages((msgs) =>
            msgs.map((msg) =>
              msg.id === tempId ? { ...realMessage, status: ChatStatus.SENT } : msg
            )
          );
        }, []);

        // Step 3: Handle Pusher message (with dedup guard)
        const handleSSEMessage = useCallback((message: ChatMessage) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === message.id);
            if (exists) return prev;
            return [...prev, message];
          });
        }, []);

        return { messages, addOptimisticMessage, replaceWithRealId, handleSSEMessage };
      });

      // Step 1: User sends message - add optimistic message
      const optimisticMessage: ChatMessage = {
        id: "temp_123",
        message: "Hello",
        role: ChatRole.USER,
        status: ChatStatus.SENDING,
        createdAt: new Date(),
      };

      act(() => {
        result.current.addOptimisticMessage(optimisticMessage);
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("temp_123");

      // Step 2: POST succeeds - replace temp id with real DB id
      const realMessage: ChatMessage = {
        id: "msg-real-456",
        message: "Hello",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        createdAt: new Date(),
      };

      act(() => {
        result.current.replaceWithRealId("temp_123", realMessage);
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("msg-real-456");

      // Step 3: Pusher bounces the message back - should be deduplicated
      const pusherMessage: ChatMessage = {
        id: "msg-real-456", // Same real id from DB
        message: "Hello",
        role: ChatRole.USER,
        status: ChatStatus.SENT,
        createdAt: new Date(),
      };

      act(() => {
        result.current.handleSSEMessage(pusherMessage);
      });

      // Should still have only one message (no duplicate)
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe("msg-real-456");
    });

    it("should allow other users' messages through after sender's message is deduplicated", () => {
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([]);

        const addOptimisticMessage = useCallback((message: ChatMessage) => {
          setMessages((msgs) => [...msgs, message]);
        }, []);

        const replaceWithRealId = useCallback((tempId: string, realMessage: ChatMessage) => {
          setMessages((msgs) =>
            msgs.map((msg) =>
              msg.id === tempId ? { ...realMessage, status: ChatStatus.SENT } : msg
            )
          );
        }, []);

        const handleSSEMessage = useCallback((message: ChatMessage) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === message.id);
            if (exists) return prev;
            return [...prev, message];
          });
        }, []);

        return { messages, addOptimisticMessage, replaceWithRealId, handleSSEMessage };
      });

      // Sender's message flow
      act(() => {
        result.current.addOptimisticMessage({
          id: "temp_123",
          message: "Hello",
          role: ChatRole.USER,
          status: ChatStatus.SENDING,
          createdAt: new Date(),
        });
      });

      act(() => {
        result.current.replaceWithRealId("temp_123", {
          id: "msg-real-456",
          message: "Hello",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      // Pusher bounce (deduplicated)
      act(() => {
        result.current.handleSSEMessage({
          id: "msg-real-456",
          message: "Hello",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      expect(result.current.messages).toHaveLength(1);

      // Another user's message arrives via Pusher
      act(() => {
        result.current.handleSSEMessage({
          id: "msg-789",
          message: "Hi there!",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      // Should now have 2 messages
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].id).toBe("msg-789");
      expect(result.current.messages[1].message).toBe("Hi there!");
    });
  });
});
