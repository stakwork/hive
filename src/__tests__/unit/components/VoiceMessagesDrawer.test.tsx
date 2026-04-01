import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- mocks ----------------------------------------------------------------

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

vi.mock("lucide-react", () => ({
  SendHorizontal: () => <svg data-testid="send-icon" />,
}));

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const mockSendMessage = vi.fn();

// Default store state — can be overridden per-test via setStoreState()
let storeState = {
  messages: [] as { id: string; timestamp: number; message: string; sender: "agent" | "user" }[],
  transcription: null as null,
  isConnected: true,
  sendMessage: mockSendMessage,
};

vi.mock("@/stores/useVoiceStore", () => ({
  useVoiceStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

function setStoreState(overrides: Partial<typeof storeState>) {
  storeState = { ...storeState, ...overrides };
}

// ---- import after mocks ---------------------------------------------------
import { VoiceMessagesDrawer } from "@/components/voice/VoiceMessagesDrawer";

// ---- helpers ---------------------------------------------------------------

function renderDrawer(open = true) {
  const onOpenChange = vi.fn();
  render(<VoiceMessagesDrawer open={open} onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

// ---- tests -----------------------------------------------------------------

describe("VoiceMessagesDrawer — text input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      messages: [],
      transcription: null,
      isConnected: true,
      sendMessage: mockSendMessage,
    };
  });

  test("renders the chat input and send button when open", () => {
    renderDrawer();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument();
  });

  test("SheetDescription shows 'Chat with Jamie'", () => {
    renderDrawer();
    expect(screen.getByText("Chat with Jamie")).toBeInTheDocument();
  });

  test("input and button are disabled when not connected", () => {
    setStoreState({ isConnected: false });
    renderDrawer();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
  });

  test("input and button are enabled when connected", () => {
    setStoreState({ isConnected: true });
    renderDrawer();
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /send message/i })).not.toBeDisabled();
  });

  test("handleSend does not call sendMessage on empty input", async () => {
    renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("handleSend does not call sendMessage on whitespace-only input", async () => {
    renderDrawer();
    await userEvent.type(screen.getByRole("textbox"), "   ");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("clicking Send calls sendMessage and clears input", async () => {
    renderDrawer();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "hello");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(mockSendMessage).toHaveBeenCalledWith("hello");
    expect(input).toHaveValue("");
  });

  test("pressing Enter calls sendMessage and clears input", async () => {
    renderDrawer();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "hi there");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(mockSendMessage).toHaveBeenCalledWith("hi there");
    expect(input).toHaveValue("");
  });

  test("pressing Shift+Enter does NOT submit", async () => {
    renderDrawer();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "multi");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("VoiceMessagesDrawer — MessageBubble rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("agent messages are rendered left-aligned with bg-muted", () => {
    setStoreState({
      messages: [{ id: "1", timestamp: Date.now(), message: "Hello user", sender: "agent" }],
    });
    renderDrawer();
    const bubble = screen.getByText("Hello user");
    expect(bubble.className).toContain("bg-muted");
    expect(bubble.className).not.toContain("ml-auto");
  });

  test("user messages are rendered right-aligned with bg-primary", () => {
    setStoreState({
      messages: [{ id: "2", timestamp: Date.now(), message: "My message", sender: "user" }],
    });
    renderDrawer();
    const bubble = screen.getByText("My message");
    expect(bubble.className).toContain("bg-primary");
    expect(bubble.className).toContain("ml-auto");
  });
});
