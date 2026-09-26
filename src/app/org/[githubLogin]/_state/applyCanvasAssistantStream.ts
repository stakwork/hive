/**
 * Shared `processStream` → timeline-split → `replaceAssistantStream`
 * mapper for org-canvas chat.
 *
 * Used by both the one-shot send (`useSendCanvasChatMessage`) and the
 * refresh reattach (`useResumeCanvasChatStream`). The live prefix passed
 * to `replaceAssistantStream` must be a fresh id — never the persisted
 * `turnId` — so replay strips only ephemeral preview rows and leaves
 * seeded `${turnId}-u` / `${turnId}-a*` rows in place.
 */
import type {
  StreamReasoningPart,
  StreamTimelineItem,
  StreamToolCall,
} from "@/types/streaming";
import type { ApprovalResult } from "@/lib/proposals/types";
import type { CanvasChatMessage, ToolCall } from "./canvasChatStore";

export interface AssistantStreamUpdate {
  timeline?: StreamTimelineItem[];
  error?: string;
  usage?: CanvasChatMessage["usage"];
}

export interface ApplyCanvasAssistantStreamArgs {
  conversationId: string;
  /** Fresh live prefix. Rows are written as `${messageId}-N`. */
  messageId: string;
  updatedMessage: AssistantStreamUpdate;
  approvalResult?: ApprovalResult | null;
  loggedToolCalls?: Set<string>;
  setRunActive?: (conversationId: string, active: boolean) => void;
  setActiveToolCalls: (conversationId: string, toolCalls: ToolCall[]) => void;
  replaceAssistantStream: (
    conversationId: string,
    prefix: string,
    next: CanvasChatMessage[],
  ) => void;
}

/**
 * Scan a rebuilt assistant-side timeline for a completed `schedule_check`
 * tool call and return its parsed `deferredCheck` metadata, or `null`.
 * Mirrors `extractDeferredCheckFromStep` in `canvas-turn-persistence.ts`.
 */
function extractDeferredCheck(
  messages: CanvasChatMessage[],
): CanvasChatMessage["deferredCheck"] | null {
  for (const m of messages) {
    const tc = m.toolCalls?.find(
      (c) => c.toolName === "schedule_check" && c.output != null,
    );
    if (!tc) continue;
    const out = tc.output as Record<string, unknown>;
    if (
      typeof out.deferredActionId === "string" &&
      typeof out.fireAt === "string" &&
      typeof out.description === "string"
    ) {
      return {
        id: out.deferredActionId,
        description: out.description,
        fireAt: out.fireAt,
        status: "PENDING",
      };
    }
  }
  return null;
}

function logToolCall(toolCall: {
  id: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  status: string;
}, loggedToolCalls: Set<string>) {
  if (typeof window === "undefined") return;
  if (
    !/^\/org\/[^/]+$/.test(window.location.pathname) &&
    !(window as Window & { DEBUG?: boolean }).DEBUG
  ) {
    return;
  }
  const callKey = `${toolCall.id}-${toolCall.status}`;
  if (loggedToolCalls.has(callKey)) return;
  loggedToolCalls.add(callKey);
  if (toolCall.status === "input-available" || toolCall.status === "input-start") {
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

/**
 * Rebuild the assistant-side timeline from one stream update and write it
 * into the store. Handles `text`, `toolCall`, and `reasoning` — a reasoning
 * item flushes any pending text/tools first so `StreamingMessage` can
 * render thinking in arrival order.
 */
export function applyCanvasAssistantStream({
  conversationId,
  messageId,
  updatedMessage,
  approvalResult,
  loggedToolCalls,
  setRunActive,
  setActiveToolCalls,
  replaceAssistantStream,
}: ApplyCanvasAssistantStreamArgs): void {
  const timeline = updatedMessage.timeline || [];
  const timelineMessages: CanvasChatMessage[] = [];
  let currentText = "";
  let currentToolCalls: ToolCall[] = [];
  // Raw stream timeline items for the current tool-call run, kept
  // alongside `currentToolCalls` so the tool message carries the
  // rich `StreamToolCall` data (`inputText`, typed status) that
  // `<StreamingMessage>` renders. `toolCalls` stays the lossy
  // model/sub-agent projection; this is the display layer.
  let currentToolItems: StreamTimelineItem[] = [];
  let msgCounter = 0;
  const seenToolCalls = loggedToolCalls ?? new Set<string>();

  const flushTools = () => {
    if (currentToolCalls.length === 0) return;
    timelineMessages.push({
      id: `${messageId}-${msgCounter++}`,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      toolCalls: currentToolCalls,
      timeline: currentToolItems,
    });
    currentToolCalls = [];
    currentToolItems = [];
  };

  const flushText = () => {
    if (!currentText.trim()) return;
    timelineMessages.push({
      id: `${messageId}-${msgCounter++}`,
      role: "assistant",
      content: currentText,
      timestamp: new Date(),
    });
    currentText = "";
  };

  for (const item of timeline) {
    if (item.type === "text") {
      // Symmetric flush: if tool calls are pending, emit them before
      // starting the next text run, preserving true arrival order.
      flushTools();
      currentText += (item.data as { content: string }).content;
    } else if (item.type === "reasoning") {
      // Thinking is its own timeline row so StreamingMessage can render
      // it between text and tools. Flush both pending runs first.
      flushTools();
      flushText();
      const reasoning = item.data as StreamReasoningPart;
      timelineMessages.push({
        id: `${messageId}-${msgCounter++}`,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        timeline: [item],
      });
      void reasoning;
    } else if (item.type === "toolCall") {
      flushText();
      const toolCall = item.data as StreamToolCall;

      logToolCall(toolCall, seenToolCalls);

      // Local repo_agent run-active detection for instant Stop feedback.
      // toolName may be bare ("repo_agent") or namespaced ("ws__repo_agent").
      const isRepoAgent =
        toolCall.toolName === "repo_agent" ||
        toolCall.toolName.endsWith("__repo_agent");
      if (isRepoAgent && setRunActive) {
        // A call is in flight once input is available and no output has
        // landed yet. `output-available` / `output-error` clear it; Pusher
        // is the other clearer.
        if (
          toolCall.status === "input-available" &&
          toolCall.output === undefined
        ) {
          setRunActive(conversationId, true);
        } else if (
          toolCall.output !== undefined ||
          toolCall.status === "output-available" ||
          toolCall.status === "output-error"
        ) {
          setRunActive(conversationId, false);
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
      currentToolItems.push(item);
    }
  }

  flushTools();
  flushText();

  // Stamp the structured approval outcome onto the last
  // assistant text message in this batch, when the route
  // returned one. This is what the proposal card scans for
  // when computing status, and what survives a refresh
  // because the field round-trips through
  // `SharedConversation.messages` JSON.
  if (approvalResult) {
    for (let i = timelineMessages.length - 1; i >= 0; i--) {
      const m = timelineMessages[i];
      if (m.role === "assistant" && !m.toolCalls?.length && !m.timeline?.length) {
        timelineMessages[i] = { ...m, approvalResult };
        break;
      }
    }
  }

  // Stamp deferred-check metadata onto the assistant message when a
  // `schedule_check` tool call completed in this turn, so the
  // `DeferredCheckCard` renders live. This mirrors the server-side
  // `messagesFromSteps` extraction (anchoring to the text row when
  // present, else the tool-call row); without it the card only
  // surfaces after a reload / Pusher sync.
  const deferredCheck = extractDeferredCheck(timelineMessages);
  if (deferredCheck) {
    const textIdx = (() => {
      for (let i = timelineMessages.length - 1; i >= 0; i--) {
        const m = timelineMessages[i];
        if (m.role === "assistant" && !m.toolCalls?.length && !m.timeline?.length) {
          return i;
        }
      }
      return -1;
    })();
    if (textIdx >= 0) {
      timelineMessages[textIdx] = {
        ...timelineMessages[textIdx],
        deferredCheck,
      };
    } else {
      for (let i = timelineMessages.length - 1; i >= 0; i--) {
        const m = timelineMessages[i];
        if (
          m.role === "assistant" &&
          m.toolCalls?.some((c) => c.toolName === "schedule_check")
        ) {
          timelineMessages[i] = { ...m, deferredCheck };
          break;
        }
      }
    }
  }

  // Surface a mid-stream error part. The server forwards the
  // real message via `toUIMessageStreamResponse({ onError })`,
  // and `useStreamProcessor` exposes it as `updatedMessage.error`.
  // Without this the error part is dropped (the timeline rebuild
  // above ignores it), so a stream that errored *after* the 200
  // headers — e.g. an Anthropic request rejection — would render
  // nothing at all. Append it as a trailing assistant message so
  // it shows inline after whatever partial content streamed.
  if (updatedMessage.error) {
    timelineMessages.push({
      id: `${messageId}-error`,
      role: "assistant",
      content: updatedMessage.error,
      timestamp: new Date(),
    });
  }

  // Stamp cumulative usage onto the last tool-call batch row so
  // StreamingMessage can render TurnTokenUsage live (mid-stream,
  // after each step) and as a final value once the turn ends.
  // Runs on every update when usage is present, not only on finish.
  // No text-only fallback: text-only turns render via
  // SidebarChatMessage which has no TurnTokenUsage render path.
  if (updatedMessage.usage) {
    for (let i = timelineMessages.length - 1; i >= 0; i--) {
      const m = timelineMessages[i];
      if (m.role === "assistant" && !!m.timeline?.length) {
        timelineMessages[i] = { ...m, usage: updatedMessage.usage };
        break;
      }
    }
  }

  const lastMsg = timelineMessages[timelineMessages.length - 1];
  if (lastMsg?.toolCalls && lastMsg.toolCalls.length > 0) {
    setActiveToolCalls(conversationId, lastMsg.toolCalls);
  } else {
    setActiveToolCalls(conversationId, []);
  }

  replaceAssistantStream(conversationId, messageId, timelineMessages);
}
