"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { type CanvasChatMessage, useCanvasChatStore, type InitiativeFocus } from "../../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../../_state/useSendCanvasChatMessage";
import { getPendingJobTurnsFromMessages } from "../JobTurnCard";
import { PendingOrchestratorTurnCard, pendingOrchestratorLaunchIds } from "../OrchestratorTurnCard";
import { TYPE } from "./nodes";
import { v } from "./theme";

/** Jamie's three sizes: just the input, the input with the last reply, or the full chat beside the canvas. */
export type JamieMode = "input" | "last" | "full";

/**
 * Sends words to Jamie from the canvas: the bar, or a card's Ask Jamie. The
 * card it's about goes into the conversation's hidden context first, so the
 * turn (and any strut job it starts) works on that part of the graph even
 * when the click and the send land in the same moment.
 */
export function useAskJamie() {
  const send = useSendCanvasChatMessage();
  return useCallback(
    async (text: string, focus: InitiativeFocus | null) => {
      const store = useCanvasChatStore.getState();
      const id = store.activeConversationId;
      if (!id || !text.trim()) return false;
      if (store.conversations[id]?.activeTurn) return false;
      store.setInitiativeFocus(focus);
      store.updateActiveContext({ initiativeFocus: focus });
      await send({ conversationId: id, content: text });
      return true;
    },
    [send],
  );
}

const NO_MESSAGES: CanvasChatMessage[] = [];

/**
 * The turn after your latest message, picked the way the chat picks it:
 * whether strut still has it (a launch with no reply,
 * `pendingOrchestratorLaunchIds`), the jobs it has running
 * (`getPendingJobTurnsFromMessages`), and the latest reply. The detail
 * (job cards, proposals) lives in the full chat.
 */
function useJamieTurn() {
  const messages = useCanvasChatStore((s) =>
    s.activeConversationId ? (s.conversations[s.activeConversationId]?.messages ?? NO_MESSAGES) : NO_MESSAGES,
  );
  const working = useCanvasChatStore((s) => {
    const c = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
    return !!(c?.isLoading || c?.isStreaming || c?.activeTurn);
  });
  const turn = useMemo(() => {
    const since = messages.findLastIndex((m) => m.role === "user");
    const rows = since === -1 ? [] : messages.slice(since + 1);
    const inTurn = new Set(rows.map((m) => m.id));
    const pending = pendingOrchestratorLaunchIds(messages);
    const launch = rows.findLast((m) => m.source?.kind === "orchestrator_launch" && pending.has(m.id))?.source;
    const jobs = getPendingJobTurnsFromMessages(messages).filter((t) => inTurn.has(t.anchorMessageId));
    const reply =
      rows.findLast(
        (m) => m.role === "assistant" && (!m.source || m.source.kind === "orchestrator") && m.content.trim(),
      )?.content ?? "";
    return {
      key: since === -1 ? "" : messages[since].id,
      launch: launch?.kind === "orchestrator_launch" ? launch : undefined,
      jobs,
      reply,
    };
  }, [messages]);
  return { ...turn, working };
}

const chip = {
  fontFamily: TYPE,
  fontSize: 13,
  padding: "4px 12px",
  borderRadius: 99,
  border: `1px solid ${v("borderStrong")}`,
  background: v("chrome"),
  color: v("ink"),
  cursor: "pointer",
} as const;

const small = {
  border: "none",
  background: "none",
  cursor: "pointer",
  color: v("muted"),
  fontSize: 15,
  lineHeight: 1,
  padding: "2px 4px",
} as const;

/**
 * The bar on the canvas: Jamie's last reply above the input, folded away or
 * opened into the full chat. Mic first: speak, and stopping sends what was
 * heard.
 */
export function JamieBar({
  mode,
  setMode,
  send,
}: {
  mode: Exclude<JamieMode, "full">;
  setMode: (m: JamieMode) => void;
  send: (text: string) => Promise<boolean> | boolean;
}) {
  const { key, reply, launch, jobs, working } = useJamieTurn();
  // Strut has the turn: from the send (before its marker has synced) until its reply lands.
  const busy = !!launch || (working && !reply);
  const jobsNote = jobs.length === 1 ? jobs[0].title || "1 job" : jobs.length > 1 ? `${jobs.length} jobs` : undefined;
  // What Jamie has said this turn: new since you folded the bar is unread.
  const said = `${key}\u0000${reply}`;
  const [seen, setSeen] = useState(said);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unread = mode === "input" && said !== seen && !!reply;
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();
  useEffect(() => {
    if (isListening && transcript) setText(transcript);
  }, [isListening, transcript]);

  // Grow with the text (Shift+Enter adds lines) up to the cap, then scroll; collapse when emptied or sent.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (text) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    else el.style.height = "";
  }, [text]);

  const submit = async (words = text) => {
    if (!words.trim() || working) return;
    setText("");
    // Show the turn at once: Jamie working, then the reply as it streams.
    setMode("last");
    if (!(await send(words.trim()))) setMode("input");
  };
  const toggleMic = () => {
    if (!isListening) {
      resetTranscript();
      setText("");
      startListening();
      return;
    }
    stopListening();
    void submit(transcript || text);
  };

  return (
    <div
      data-jamie-bar
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        width: "min(720px, calc(100% - 32px))",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 20,
      }}
    >
      {busy ? (
        // Working: the chat's own card, just above the bar; the detail (jobs, proposals) is in the full chat.
        <button
          type="button"
          data-working
          title="Open the full chat"
          onClick={() => setMode("full")}
          style={{
            alignSelf: "center",
            width: "min(460px, 100%)",
            padding: 0,
            border: "none",
            background: "none",
            borderRadius: 10,
            boxShadow: v("shadow"),
            cursor: "pointer",
            textAlign: "left",
            fontFamily: TYPE,
          }}
        >
          <PendingOrchestratorTurnCard source={launch} detail={jobsNote} />
        </button>
      ) : mode === "last" && reply ? (
        <div
          key={key || "idle"}
          className="icb-bloom"
          data-reply
          style={{
            alignSelf: "center",
            maxWidth: "92%",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 10px 10px 16px",
            borderRadius: 14,
            background: v("sheet"),
            boxShadow: v("shadow"),
            fontFamily: TYPE,
            fontSize: 15,
            lineHeight: 1.35,
            color: v("ink"),
          }}
        >
          <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: v("job"), letterSpacing: ".08em", paddingTop: 3 }}>JAMIE</span>
            <div
              data-turn
              style={{ maxHeight: "26vh", overflowY: "auto", minWidth: 0 }}
              className="[&_*]:!text-[var(--ic-ink)]"
            >
              <MarkdownRenderer variant="assistant" size="compact">
                {reply}
              </MarkdownRenderer>
            </div>
          </div>
          <button
            type="button"
            aria-label="Open the full chat"
            title="Open the full chat"
            data-expand
            onClick={() => setMode("full")}
            style={small}
          >
            ⤢
          </button>
          <button
            type="button"
            aria-label="Fold Jamie's reply"
            title="Fold"
            data-fold
            onClick={() => {
              setMode("input");
              setSeen(said);
            }}
            style={small}
          >
            ⌄
          </button>
        </div>
      ) : (
        <div style={{ alignSelf: "center", display: "flex", gap: 6 }}>
          {reply ? (
            <button
              type="button"
              data-unfold
              onClick={() => setMode("last")}
              style={{ ...chip, display: "inline-flex", alignItems: "center", gap: 6, color: v("muted") }}
            >
              {unread ? <span style={{ width: 7, height: 7, borderRadius: 9, background: v("job") }} /> : null}
              Jamie’s reply ⌃
            </button>
          ) : null}
          <button type="button" data-expand onClick={() => setMode("full")} style={{ ...chip, color: v("muted") }}>
            ⤢ Full chat
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 10px 8px 8px",
          borderRadius: 99,
          overflow: "hidden",
          background: v("chrome"),
          border: `1px solid ${v("chromeBorder")}`,
          boxShadow: v("shadowBig"),
        }}
      >
        <button
          type="button"
          aria-label={isListening ? "Stop and send" : "Talk to Jamie"}
          title={
            isSupported ? (isListening ? "Stop and send" : "Talk to Jamie") : "Voice isn't available in this browser"
          }
          data-orb
          disabled={!isSupported}
          onClick={toggleMic}
          className={isListening ? "icb-listen" : working ? "icb-pulse" : undefined}
          style={{
            flexShrink: 0,
            width: 46,
            height: 46,
            borderRadius: 99,
            border: "none",
            cursor: isSupported ? "pointer" : "default",
            background: isListening ? v("job") : v("ink"),
            opacity: isSupported ? 1 : 0.55,
            color: v("onInk"),
            display: "grid",
            placeItems: "center",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <textarea
            ref={inputRef}
            rows={1}
            data-jamie-input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Shift+Enter falls through to the textarea's own newline; never send mid-composition.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
            }}
            placeholder=""
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: `1px solid ${v("border")}`,
              borderRadius: 23,
              background: v("field"),
              color: v("fieldInk"),
              padding: "6px 12px",
              fontFamily: TYPE,
              fontSize: 14,
              outline: "none",
              resize: "none",
              maxHeight: 200,
              overflowY: "auto",
              display: "block",
            }}
          />
        </div>
      </div>
    </div>
  );
}
