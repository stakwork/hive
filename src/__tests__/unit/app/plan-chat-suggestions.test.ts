// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatRole, WorkflowStatus } from "@/lib/chat";
import type { ChatMessage } from "@/lib/chat";
import { isClarifyingQuestions } from "@/types/stakwork";

/**
 * Unit tests for the suggestions logic extracted from PlanChatView.
 * Tests the core logic around when to fetch suggestions and when to clear them.
 */

// Simulate the core suggestions logic from PlanChatView
function buildSuggestionsLogic(featureId: string) {
  let suggestions: string[] = [];
  const messagesRef: { current: ChatMessage[] } = { current: [] };
  const fetchMock = vi.fn();

  const setSuggestions = (s: string[]) => {
    suggestions = s;
  };

  const fetchSuggestions = async (msgs: ChatMessage[]) => {
    try {
      const res = await fetchMock(`/api/features/${featureId}/suggestions`, {
        method: "POST",
        body: JSON.stringify({
          messages: msgs.slice(-5).map((m) => ({ role: m.role, message: m.message })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        }
      }
    } catch {
      // Fail silently
    }
  };

  const handleSSEMessage = async (message: ChatMessage) => {
    if (message.role === ChatRole.ASSISTANT) {
      const hasClarifyingQuestions = message.artifacts?.some(
        (a) => a.type === "PLAN" && isClarifyingQuestions(a.content),
      );
      if (!hasClarifyingQuestions) {
        await fetchSuggestions([...messagesRef.current, message]);
      }
    }
  };

  const sendMessage = async (_text: string) => {
    setSuggestions([]);
    // ... rest of send logic omitted
  };

  const handleWorkflowStatusUpdate = (update: { workflowStatus: WorkflowStatus }) => {
    if (update.workflowStatus === WorkflowStatus.IN_PROGRESS) {
      setSuggestions([]);
    }
  };

  const getSuggestions = () => suggestions;

  return {
    handleSSEMessage,
    sendMessage,
    handleWorkflowStatusUpdate,
    getSuggestions,
    setSuggestions,
    fetchMock,
    messagesRef,
  };
}

function makeAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: ChatRole.ASSISTANT,
    message: "Sounds great! Let me help you build this.",
    status: "SENT" as any,
    artifacts: [],
    attachments: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ChatMessage;
}

function makeClarifyingArtifact() {
  return {
    id: "artifact-1",
    type: "PLAN" as const,
    content: {
      tool_use: "ask_clarifying_questions",
      content: [
        {
          question: "What is your target audience?",
        },
      ],
    },
  };
}

describe("PlanChatView Suggestions Logic", () => {
  const featureId = "feature-abc";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchSuggestions on assistant message", () => {
    it("calls fetchSuggestions after a normal assistant message", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ suggestions: ["Yes, go ahead", "Looks good", "LGTM!"] }),
      });

      const msg = makeAssistantMessage();
      await logic.handleSSEMessage(msg);

      expect(logic.fetchMock).toHaveBeenCalledTimes(1);
      expect(logic.fetchMock).toHaveBeenCalledWith(
        `/api/features/${featureId}/suggestions`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("sets suggestions state on successful response", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ suggestions: ["Yes, go ahead", "Looks good", "LGTM!"] }),
      });

      const msg = makeAssistantMessage();
      await logic.handleSSEMessage(msg);

      expect(logic.getSuggestions()).toEqual(["Yes, go ahead", "Looks good", "LGTM!"]);
    });

    it("does NOT call fetchSuggestions when assistant message has clarifying questions artifact", async () => {
      const logic = buildSuggestionsLogic(featureId);

      const msg = makeAssistantMessage({
        artifacts: [makeClarifyingArtifact() as any],
      });
      await logic.handleSSEMessage(msg);

      expect(logic.fetchMock).not.toHaveBeenCalled();
      expect(logic.getSuggestions()).toEqual([]);
    });

    it("does NOT call fetchSuggestions for USER messages", async () => {
      const logic = buildSuggestionsLogic(featureId);

      const msg: ChatMessage = {
        id: "msg-user",
        role: ChatRole.USER,
        message: "I want to build an app",
        status: "SENT" as any,
        artifacts: [],
        attachments: [],
        createdAt: new Date().toISOString(),
      } as ChatMessage;

      await logic.handleSSEMessage(msg);

      expect(logic.fetchMock).not.toHaveBeenCalled();
    });

    it("does NOT set suggestions when API returns empty array", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ suggestions: [] }),
      });

      const msg = makeAssistantMessage();
      await logic.handleSSEMessage(msg);

      expect(logic.getSuggestions()).toEqual([]);
    });

    it("fails silently when fetch throws an error", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockRejectedValue(new Error("Network error"));

      const msg = makeAssistantMessage();
      // Should not throw
      await expect(logic.handleSSEMessage(msg)).resolves.toBeUndefined();
      expect(logic.getSuggestions()).toEqual([]);
    });

    it("fails silently when API returns non-ok response", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockResolvedValue({ ok: false });

      const msg = makeAssistantMessage();
      await logic.handleSSEMessage(msg);

      expect(logic.getSuggestions()).toEqual([]);
    });
  });

  describe("suggestions cleared on sendMessage", () => {
    it("clears suggestions when sendMessage is called", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.setSuggestions(["Yes, go ahead", "LGTM!"]);
      expect(logic.getSuggestions()).toHaveLength(2);

      await logic.sendMessage("some user message");

      expect(logic.getSuggestions()).toEqual([]);
    });
  });

  describe("suggestions cleared on workflow IN_PROGRESS", () => {
    it("clears suggestions when workflow transitions to IN_PROGRESS", () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.setSuggestions(["Yes, go ahead", "Looks good"]);
      expect(logic.getSuggestions()).toHaveLength(2);

      logic.handleWorkflowStatusUpdate({ workflowStatus: WorkflowStatus.IN_PROGRESS });

      expect(logic.getSuggestions()).toEqual([]);
    });

    it("does NOT clear suggestions when workflow transitions to COMPLETED", () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.setSuggestions(["Yes, go ahead", "Looks good"]);

      logic.handleWorkflowStatusUpdate({ workflowStatus: WorkflowStatus.COMPLETED });

      expect(logic.getSuggestions()).toHaveLength(2);
    });

    it("does NOT clear suggestions when workflow transitions to FAILED", () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.setSuggestions(["Yes, go ahead", "Looks good"]);

      logic.handleWorkflowStatusUpdate({ workflowStatus: WorkflowStatus.FAILED });

      expect(logic.getSuggestions()).toHaveLength(2);
    });
  });

  describe("passthrough: messagesRef provides context for fetchSuggestions", () => {
    it("includes prior messages when calling fetchSuggestions", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ suggestions: ["Sounds good"] }),
      });

      const priorMsg: ChatMessage = {
        id: "prior-1",
        role: ChatRole.USER,
        message: "I want to build a dashboard",
        status: "SENT" as any,
        artifacts: [],
        attachments: [],
        createdAt: new Date().toISOString(),
      } as ChatMessage;
      logic.messagesRef.current = [priorMsg];

      const assistantMsg = makeAssistantMessage({ id: "msg-2" });
      await logic.handleSSEMessage(assistantMsg);

      const callBody = JSON.parse(logic.fetchMock.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(2);
      expect(callBody.messages[0]).toEqual({ role: ChatRole.USER, message: "I want to build a dashboard" });
      expect(callBody.messages[1]).toEqual({ role: ChatRole.ASSISTANT, message: assistantMsg.message });
    });

    it("only sends last 5 messages to the suggestions endpoint", async () => {
      const logic = buildSuggestionsLogic(featureId);
      logic.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ suggestions: ["Sounds good"] }),
      });

      // Populate ref with 6 messages
      const manyMsgs: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({
        id: `m-${i}`,
        role: i % 2 === 0 ? ChatRole.USER : ChatRole.ASSISTANT,
        message: `Message ${i}`,
        status: "SENT" as any,
        artifacts: [],
        attachments: [],
        createdAt: new Date().toISOString(),
      } as ChatMessage));
      logic.messagesRef.current = manyMsgs;

      const assistantMsg = makeAssistantMessage({ id: "final-msg" });
      await logic.handleSSEMessage(assistantMsg);

      const callBody = JSON.parse(logic.fetchMock.mock.calls[0][1].body);
      // [6 prior + 1 new] = 7, sliced to last 5
      expect(callBody.messages).toHaveLength(5);
    });
  });
});
