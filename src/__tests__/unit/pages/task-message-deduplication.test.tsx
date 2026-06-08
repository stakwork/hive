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
  describe("Initial fetch response parsing (canvas TaskChat)", () => {
    // Simulates the extraction logic fixed in TaskChat's useEffect:
    //   const data = (body?.data?.messages ?? body?.data ?? body ?? []) as ChatMessage[];
    //   setMessages(Array.isArray(data) ? data : []);

    function extractMessages(body: unknown): ChatMessage[] {
      const data = (
        (body as Record<string, unknown>)?.data as Record<string, unknown>
      )?.messages ??
        (body as Record<string, unknown>)?.data ??
        body ??
        [];
      return Array.isArray(data) ? (data as ChatMessage[]) : [];
    }

    it("should extract messages from nested { data: { task, messages, count } } shape", () => {
      const messages: ChatMessage[] = [
        { id: "msg-1", message: "Hi", role: ChatRole.USER, status: ChatStatus.SENT, createdAt: new Date() },
        { id: "msg-2", message: "Hello", role: ChatRole.ASSISTANT, status: ChatStatus.SENT, createdAt: new Date() },
      ];

      const body = {
        success: true,
        data: {
          task: { id: "task-abc", title: "My task" },
          messages,
          count: 2,
        },
      };

      const result = extractMessages(body);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("msg-1");
      expect(result[1].id).toBe("msg-2");
    });

    it("should return empty array when body.data is a non-array object without messages key", () => {
      const body = { success: true, data: { task: {}, count: 0 } };
      const result = extractMessages(body);
      expect(result).toEqual([]);
    });

    it("should fall back to body.data if body.data is already an array", () => {
      const messages: ChatMessage[] = [
        { id: "msg-3", message: "Fallback", role: ChatRole.USER, status: ChatStatus.SENT, createdAt: new Date() },
      ];
      const body = { success: true, data: messages };
      const result = extractMessages(body);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("msg-3");
    });

    it("should return empty array when body is null/undefined", () => {
      expect(extractMessages(null)).toEqual([]);
      expect(extractMessages(undefined)).toEqual([]);
    });
  });

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

    it("should filter optimistic placeholder when Pusher delivers real id before POST response (canvas TaskChat race)", () => {
      // Simulates the race condition fixed in TaskChat.sendInternal:
      // 1. Optimistic (temp) message added to state.
      // 2. Pusher delivers real-DB-id message BEFORE the POST response returns.
      // 3. POST response arrives — instead of mapping temp→real (which would duplicate),
      //    the fix detects the real id already exists and removes the optimistic entry.
      const { result } = renderHook(() => {
        const [messages, setMessages] = useState<ChatMessage[]>([]);

        const addOptimisticMessage = useCallback((message: ChatMessage) => {
          setMessages((msgs) => [...msgs, message]);
        }, []);

        // Simulates handleSSEMessage (Pusher) — adds if not already present
        const handleSSEMessage = useCallback((message: ChatMessage) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
        }, []);

        // Simulates the FIXED sendInternal id-swap logic from TaskChat
        const handlePostResponse = useCallback(
          (optimisticId: string, realMessage: ChatMessage) => {
            setMessages((m) => {
              if (m.some((x) => x.id === realMessage.id)) {
                // Real id already present (Pusher won the race) — drop the optimistic
                return m.filter((x) => x.id !== optimisticId);
              }
              return m.map((x) =>
                x.id === optimisticId
                  ? { ...realMessage, status: ChatStatus.SENT }
                  : x,
              );
            });
          },
          [],
        );

        return { messages, addOptimisticMessage, handleSSEMessage, handlePostResponse };
      });

      const optimisticId = "temp_race_001";
      const realId = "msg-db-999";

      // 1. Optimistic message added immediately on send
      act(() => {
        result.current.addOptimisticMessage({
          id: optimisticId,
          message: "Racing message",
          role: ChatRole.USER,
          status: ChatStatus.SENDING,
          createdAt: new Date(),
        });
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe(optimisticId);

      // 2. Pusher wins the race — real-DB-id message delivered BEFORE POST returns
      act(() => {
        result.current.handleSSEMessage({
          id: realId,
          message: "Racing message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      // Now state has both: temp + real
      expect(result.current.messages).toHaveLength(2);

      // 3. POST response arrives — should remove optimistic, NOT add a third entry
      act(() => {
        result.current.handlePostResponse(optimisticId, {
          id: realId,
          message: "Racing message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          createdAt: new Date(),
        });
      });

      // Exactly one message with the real DB id — no duplicates
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].id).toBe(realId);
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
