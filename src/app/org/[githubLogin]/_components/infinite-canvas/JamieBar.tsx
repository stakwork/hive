"use client";

import { useCallback, useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useCanvasChatStore, type InitiativeFocus } from "../../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../../_state/useSendCanvasChatMessage";
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

/** The active conversation's latest reply, and whether a turn is running. Selected as primitives, so streaming doesn't re-render the canvas. */
function useJamieTurn() {
  const reply = useCanvasChatStore((s) => {
    const c = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
    const m = c?.messages.findLast((x) => x.role === "assistant" && x.content.trim());
    return m?.content ?? "";
  });
  const working = useCanvasChatStore((s) => {
    const c = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
    return !!(c?.isLoading || c?.isStreaming || c?.activeTurn);
  });
  return { reply, working };
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
 * heard. "On: …" says what Jamie will work on; clicking it flies there.
 */
export function JamieBar({
  mode,
  setMode,
  onName,
  suggestions,
  send,
  goTo,
}: {
  mode: Exclude<JamieMode, "full">;
  setMode: (m: JamieMode) => void;
  onName: string;
  suggestions: string[];
  send: (text: string) => Promise<boolean> | boolean;
  goTo: () => void;
}) {
  const { reply, working } = useJamieTurn();
  const [seen, setSeen] = useState(reply);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const unread = mode === "input" && reply !== seen;
  const { isListening, transcript, isSupported, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();
  useEffect(() => {
    if (isListening && transcript) setText(transcript);
  }, [isListening, transcript]);

  const submit = async (words = text) => {
    if (!words.trim() || working) return;
    setText("");
    if (await send(words.trim())) setMode("last");
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
      {mode === "last" && (reply || working) ? (
        <div
          key={reply ? reply.slice(0, 40) : "working"}
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
            <div style={{ maxHeight: "26vh", overflowY: "auto", minWidth: 0 }} className="[&_*]:!text-[var(--ic-ink)]">
              {working && !reply ? (
                <span className="icb-pulse">Working on it…</span>
              ) : (
                <MarkdownRenderer variant="assistant" size="compact">
                  {reply}
                </MarkdownRenderer>
              )}
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
              setSeen(reply);
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

      {(focused || isListening) && suggestions.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              data-bar-suggestion={s}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void submit(s)}
              style={chip}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 10px 8px 8px",
          borderRadius: 99,
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
          <button
            type="button"
            onClick={goTo}
            data-on
            style={{
              alignSelf: "flex-start",
              maxWidth: "100%",
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: TYPE,
              fontSize: 12,
              color: v("muted"),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {isListening ? "Listening… " : working ? "Working… " : ""}On:{" "}
            <b style={{ color: v("ink"), fontWeight: 600 }}>{onName}</b>
          </button>
          <input
            data-jamie-input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            placeholder={isListening ? "Listening…" : "Talk, or type: “fill this out”, “pull up Repo picker”…"}
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: `1px solid ${v("border")}`,
              borderRadius: 99,
              background: v("field"),
              color: v("fieldInk"),
              padding: "6px 12px",
              fontFamily: TYPE,
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}
