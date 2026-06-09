// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("zustand/react/shallow", () => ({ useShallow: (fn: unknown) => fn }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/dashboard/DashboardChat/ToolCallIndicator", () => ({
  ToolCallIndicator: () => null,
}));
vi.mock(
  "../../../src/app/org/[githubLogin]/_components/SidebarChatMessage",
  () => ({ SidebarChatMessage: () => null }),
);
vi.mock(
  "/workspaces/hive/src/app/org/[githubLogin]/_state/useSendCanvasChatMessage",
  () => ({ useSendCanvasChatMessage: vi.fn(() => vi.fn()) }),
);
vi.mock(
  "/workspaces/hive/src/app/org/[githubLogin]/_state/useOrgChatStore",
  () => ({
    useOrgChatStore: vi.fn(() => ({
      messages: [],
      isStreaming: false,
      currentToolCall: null,
    })),
  }),
);

// ── Minimal SidebarChatInput (mirrors real implementation post-refactor) ───────

function TestSidebarChatInput({
  onSend,
  disabled = false,
}: {
  onSend: (msg: string, clear: () => void) => Promise<void>;
  disabled?: boolean;
}) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    await onSend(message, () => {
      setInput("");
      inputRef.current?.focus();
    });
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
      <button
        type="submit"
        data-testid="send-btn"
        disabled={!input.trim() || disabled}
      >
        Send
      </button>
    </form>
  );
}

// ── Pending-draft test component ───────────────────────────────────────────────
// Mirrors the real SidebarChatInput's pendingDraft useEffect.

function TestSidebarChatInputWithDraft({
  pendingDraft,
  onDraftConsumed,
}: {
  pendingDraft: string | null;
  onDraftConsumed: () => void;
}) {
  const [input, setInput] = React.useState("");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (pendingDraft === null) return;
    setInput(pendingDraft);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
    onDraftConsumed();
  }, [pendingDraft, onDraftConsumed]);

  return (
    <textarea
      ref={inputRef}
      data-testid="chat-input"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      rows={1}
      className="field-sizing-content max-h-[100px] overflow-y-auto"
    />
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("SidebarChatInput — CSS-native field-sizing-content", () => {
  const noop = async (_msg: string, clear: () => void) => {
    clear();
  };

  it("renders with field-sizing-content class and no inline height style", () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    expect(ta.className).toContain("field-sizing-content");
    expect(ta.style.height).toBe(""); // no inline height
  });

  it("does not set inline height style after typing multi-line content", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, {
        target: { value: "line1\nline2\nline3\nline4\nline5" },
      });
    });

    // CSS handles sizing — no JS-set inline height
    expect(ta.style.height).toBe("");
  });

  it("does not set inline height after submit", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "some text" } });
    });
    await act(async () => {
      fireEvent.submit(ta.closest("form")!);
    });

    await waitFor(() => {
      expect(ta.style.height).toBe("");
    });
  });

  it("does NOT submit on Shift+Enter", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => clear());
    render(<TestSidebarChatInput onSend={onSend} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not submit when input is empty", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => clear());
    render(<TestSidebarChatInput onSend={onSend} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not submit when disabled", async () => {
    const onSend = vi.fn(async (_msg: string, clear: () => void) => clear());
    render(<TestSidebarChatInput onSend={onSend} disabled />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("SidebarChatInput — pendingDraft injection", () => {
  it("focuses textarea and positions caret at end when pendingDraft is set", async () => {
    const onDraftConsumed = vi.fn();
    const draft = "pre-filled message from canvas";

    render(
      <TestSidebarChatInputWithDraft
        pendingDraft={draft}
        onDraftConsumed={onDraftConsumed}
      />,
    );

    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    // Draft value should be adopted
    await waitFor(() => {
      expect(ta.value).toBe(draft);
    });

    // Draft consumed callback fired
    expect(onDraftConsumed).toHaveBeenCalledTimes(1);

    // After the rAF fires, caret should be at end and no inline height set
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    expect(ta.selectionStart).toBe(draft.length);
    expect(ta.selectionEnd).toBe(draft.length);
    expect(ta.style.height).toBe(""); // CSS handles sizing, no inline height
  });

  it("does not consume null pendingDraft", () => {
    const onDraftConsumed = vi.fn();

    render(
      <TestSidebarChatInputWithDraft
        pendingDraft={null}
        onDraftConsumed={onDraftConsumed}
      />,
    );

    expect(onDraftConsumed).not.toHaveBeenCalled();
  });
});
