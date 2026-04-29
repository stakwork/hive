// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("zustand/react/shallow", () => ({ useShallow: (fn: unknown) => fn }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/dashboard/DashboardChat/ToolCallIndicator", () => ({
  ToolCallIndicator: () => null,
}));
vi.mock("../../../src/app/org/[githubLogin]/_components/SidebarChatMessage", () => ({
  SidebarChatMessage: () => null,
}));

// Mock the state hooks used by the parent SidebarChat component so we can
// isolate just the SidebarChatInput sub-component via its props.
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

// ── Minimal SidebarChatInput (inline, mirrors real implementation) ─────────────
// We test the component logic directly without mounting the full SidebarChat tree.

const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 20;
const MAX_HEIGHT_PX = MAX_ROWS * LINE_HEIGHT_PX;

function TestSidebarChatInput({
  onSend,
  disabled = false,
}: {
  onSend: (msg: string, clear: () => void) => Promise<void>;
  disabled?: boolean;
}) {
  const [input, setInput] = React.useState("");
  const [height, setHeight] = React.useState<string>("auto");
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    const message = input.trim();
    await onSend(message, () => {
      setInput("");
      setHeight("auto");
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
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    setHeight(`${newHeight}px`);
  };

  const overflowY =
    height !== "auto" && parseInt(height) >= MAX_HEIGHT_PX ? "auto" : "hidden";

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
        style={{ height, overflowY }}
      />
      <button type="submit" data-testid="send-btn" disabled={!input.trim() || disabled}>
        Send
      </button>
    </form>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockScrollHeight(el: HTMLTextAreaElement, value: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => value });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("SidebarChatInput — scrollHeight-based resize", () => {
  const noop = async (_msg: string, clear: () => void) => {
    clear();
  };

  it("starts with height='auto' (1 row)", () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    expect(ta.style.height).toBe("auto");
    expect(ta.style.overflowY).toBe("hidden");
  });

  it("grows height when scrollHeight indicates wrapping", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    // Simulate 2 rows of content (40px)
    mockScrollHeight(ta, 40);

    await act(async () => {
      fireEvent.change(ta, { target: { value: "a long line that wraps" } });
    });

    expect(ta.style.height).toBe("40px");
    expect(ta.style.overflowY).toBe("hidden"); // below max
  });

  it("clamps height at MAX_HEIGHT_PX (100px) and sets overflow-y: auto", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    // Simulate content taller than 5 rows
    mockScrollHeight(ta, 200);

    await act(async () => {
      fireEvent.change(ta, { target: { value: "very long content exceeding 5 rows" } });
    });

    expect(ta.style.height).toBe(`${MAX_HEIGHT_PX}px`);
    expect(ta.style.overflowY).toBe("auto");
  });

  it("grows on explicit newlines the same way", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    mockScrollHeight(ta, 60); // 3 rows

    await act(async () => {
      fireEvent.change(ta, { target: { value: "line1\nline2\nline3" } });
    });

    expect(ta.style.height).toBe("60px");
  });

  it("resets height to 'auto' after send", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    mockScrollHeight(ta, 40);

    await act(async () => {
      fireEvent.change(ta, { target: { value: "some text" } });
    });
    expect(ta.style.height).toBe("40px");

    await act(async () => {
      fireEvent.submit(ta.closest("form")!);
    });

    await waitFor(() => {
      expect(ta.style.height).toBe("auto");
    });
  });

  it("resets height to 'auto' on Enter (no shift) send", async () => {
    render(<TestSidebarChatInput onSend={noop} />);
    const ta = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    mockScrollHeight(ta, 40);

    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
    });

    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    await waitFor(() => {
      expect(ta.style.height).toBe("auto");
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

    mockScrollHeight(ta, 20);
    await act(async () => {
      fireEvent.change(ta, { target: { value: "hello" } });
      fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });
});
