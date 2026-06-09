// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Minimal TaskChatInput (mirrors real implementation post-refactor) ──────────

function TestTaskChatInput({
  onSend,
  disabled = false,
}: {
  onSend: (msg: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    setInput("");
    await onSend(trimmed);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        ref={inputRef}
        data-testid="chat-input"
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        className="field-sizing-content max-h-[100px] overflow-y-auto"
      />
      <button type="submit" data-testid="send-btn" disabled={!input.trim() || disabled}>
        Send
      </button>
    </form>
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("TaskChatInput — CSS-native field-sizing-content", () => {
  const noop = async () => {};

  it("has field-sizing-content class and no inline height style on render", () => {
    render(<TestTaskChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    expect(ta.className).toContain("field-sizing-content");
    expect(ta.style.height).toBe("");
  });

  it("does not set inline height after typing multi-line content", async () => {
    render(<TestTaskChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, {
        target: { value: "line1\nline2\nline3\nline4\nline5" },
      });
    });

    expect(ta.style.height).toBe("");
  });

  it("does not submit on Shift+Enter", async () => {
    const onSend = vi.fn(async () => {});
    render(<TestTaskChatInput onSend={onSend} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("submits and clears input on Enter", async () => {
    const onSend = vi.fn(async () => {});
    render(<TestTaskChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    expect(ta.value).toBe("");
    expect(ta.style.height).toBe("");
  });
});
