import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

// --- Mocks ---

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) =>
    classes.filter(Boolean).join(" "),
}));

// Minimal shadcn/ui dialog that actually renders children + footer
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <span data-testid="loader" />,
  User: () => null,
  Bot: () => null,
  Wrench: () => null,
  Code2: () => null,
  Share2: () => <span data-testid="share-icon" />,
}));

// --- Import component after mocks ---
import { LogDetailDialog } from "@/components/agent-logs/LogDetailDialog";
// ToolCallItem, MessageBubble, StatsBar are now in LogDetailContent and render through the dialog.

// ---------------------------------------------------------------------------

const noop = () => {};

// userEvent.setup() installs its own clipboard stub — always spy on
// navigator.clipboard.writeText AFTER calling userEvent.setup().
function setupClipboard() {
  return vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
}

function setupWindowLocation(href = "http://localhost:3000/w/test/agent-logs?logId=log-123") {
  Object.defineProperty(window, "location", {
    value: { href },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupWindowLocation();
  // Default fetch — returns a simple JSON log
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify([{ role: "user", content: "Hello" }]),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers to build fetch mocks that return a structured conversation
// ---------------------------------------------------------------------------

function makeStatsFetch(conversation: object[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      conversation,
      stats: {
        totalMessages: conversation.length,
        estimatedTokens: 0,
        totalToolCalls: 0,
        toolFrequency: {},
        bashFrequency: {},
        developerShellFrequency: {},
      },
    }),
  });
}

// AI SDK format tool-call message
function aiSdkToolCallMessage(toolName: string, input?: object) {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "tc-1",
        toolName,
        ...(input !== undefined ? { input } : {}),
      },
    ],
  };
}

// OpenAI format tool-call message
function openaiToolCallMessage(name: string, args?: string) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call-1",
        function: {
          name,
          ...(args !== undefined ? { arguments: args } : {}),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------

describe("ToolCallItem — rendered via LogDetailDialog", () => {
  test("renders tool name only (no show/hide) when args is null — AI SDK format", async () => {
    global.fetch = makeStatsFetch([aiSdkToolCallMessage("developer__shell")]);

    render(<LogDetailDialog open logId="log-1" onOpenChange={noop} />);

    await waitFor(() => {
      expect(screen.getByText(/developer__shell/)).toBeInTheDocument();
    });

    expect(screen.queryByText("(show)")).not.toBeInTheDocument();
    expect(screen.queryByText("(hide)")).not.toBeInTheDocument();
  });

  test("renders tool name only (no show/hide) when args is null — OpenAI format", async () => {
    global.fetch = makeStatsFetch([openaiToolCallMessage("bash")]);

    render(<LogDetailDialog open logId="log-2" onOpenChange={noop} />);

    await waitFor(() => {
      expect(screen.getByText(/bash/)).toBeInTheDocument();
    });

    expect(screen.queryByText("(show)")).not.toBeInTheDocument();
  });

  test("shows (show) toggle when AI SDK input is present", async () => {
    global.fetch = makeStatsFetch([
      aiSdkToolCallMessage("developer__shell", { command: "ls -la" }),
    ]);

    render(<LogDetailDialog open logId="log-3" onOpenChange={noop} />);

    await waitFor(() => {
      expect(screen.getByText("(show)")).toBeInTheDocument();
    });
  });

  test("shows (show) toggle when OpenAI function.arguments is present", async () => {
    global.fetch = makeStatsFetch([
      openaiToolCallMessage("bash", '{"command":"echo hello"}'),
    ]);

    render(<LogDetailDialog open logId="log-4" onOpenChange={noop} />);

    await waitFor(() => {
      expect(screen.getByText("(show)")).toBeInTheDocument();
    });
  });

  test("clicking (show) expands args and changes label to (hide)", async () => {
    const user = userEvent.setup();
    global.fetch = makeStatsFetch([
      aiSdkToolCallMessage("developer__shell", { command: "ls -la" }),
    ]);

    render(<LogDetailDialog open logId="log-5" onOpenChange={noop} />);

    await waitFor(() => {
      expect(screen.getByText("(show)")).toBeInTheDocument();
    });

    await user.click(screen.getByText("(show)"));

    expect(screen.getByText("(hide)")).toBeInTheDocument();
    // The pre block with args should now be visible
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });

  test("clicking (hide) collapses args again", async () => {
    const user = userEvent.setup();
    global.fetch = makeStatsFetch([
      aiSdkToolCallMessage("developer__shell", { command: "ls -la" }),
    ]);

    render(<LogDetailDialog open logId="log-6" onOpenChange={noop} />);

    await waitFor(() => expect(screen.getByText("(show)")).toBeInTheDocument());

    await user.click(screen.getByText("(show)"));
    expect(screen.getByText("(hide)")).toBeInTheDocument();

    await user.click(screen.getByText("(hide)"));
    expect(screen.getByText("(show)")).toBeInTheDocument();
  });

  test("AI SDK input is JSON-stringified in the expanded pre block", async () => {
    const user = userEvent.setup();
    const input = { command: "echo hello" };
    global.fetch = makeStatsFetch([aiSdkToolCallMessage("developer__shell", input)]);

    render(<LogDetailDialog open logId="log-7" onOpenChange={noop} />);

    await waitFor(() => expect(screen.getByText("(show)")).toBeInTheDocument());
    await user.click(screen.getByText("(show)"));

    // The expanded content should contain the JSON-stringified input
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
  });

  test("OpenAI function.arguments string is rendered verbatim in the expanded pre block", async () => {
    const user = userEvent.setup();
    const argsStr = '{"command":"echo world"}';
    global.fetch = makeStatsFetch([openaiToolCallMessage("bash", argsStr)]);

    render(<LogDetailDialog open logId="log-8" onOpenChange={noop} />);

    await waitFor(() => expect(screen.getByText("(show)")).toBeInTheDocument());
    await user.click(screen.getByText("(show)"));

    expect(screen.getByText(/echo world/)).toBeInTheDocument();
  });

  test("truncates args longer than 2000 chars with '... (truncated)' suffix", async () => {
    const user = userEvent.setup();
    const longValue = "x".repeat(2500);
    global.fetch = makeStatsFetch([
      aiSdkToolCallMessage("developer__shell", { big: longValue }),
    ]);

    render(<LogDetailDialog open logId="log-9" onOpenChange={noop} />);

    await waitFor(() => expect(screen.getByText("(show)")).toBeInTheDocument());
    await user.click(screen.getByText("(show)"));

    expect(screen.getByText(/\.\.\. \(truncated\)/)).toBeInTheDocument();
  });

  test("existing tool result expand/collapse is unaffected", async () => {
    const user = userEvent.setup();
    global.fetch = makeStatsFetch([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-r1",
            toolName: "developer__shell",
            output: { value: "file1.txt\nfile2.txt" },
          },
        ],
      },
    ]);

    render(<LogDetailDialog open logId="log-10" onOpenChange={noop} />);

    await waitFor(() => expect(screen.getByText(/1 tool result/)).toBeInTheDocument());

    // Initially collapsed
    expect(screen.queryByText(/file1\.txt/)).not.toBeInTheDocument();

    await user.click(screen.getByText(/1 tool result/));
    expect(screen.getByText(/file1\.txt/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("LogDetailDialog — Share button", () => {
  test("renders a Share button in the dialog footer", async () => {
    render(
      <LogDetailDialog open logId="log-123" onOpenChange={noop} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("dialog-footer")).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole("button");
    const shareBtn = buttons.find((b) => b.textContent?.includes("Share"));
    expect(shareBtn).toBeDefined();
  });

  test("Share button copies window.location.href to clipboard", async () => {
    const user = userEvent.setup();
    const writeText = setupClipboard();

    render(<LogDetailDialog open logId="log-123" onOpenChange={noop} />);

    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.some((b) => b.textContent?.includes("Share"))).toBe(true);
    });

    const shareBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Share"))!;

    await user.click(shareBtn);

    expect(writeText).toHaveBeenCalledWith(
      "http://localhost:3000/w/test/agent-logs?logId=log-123"
    );
  });

  test("Share button shows success toast after copying", async () => {
    const user = userEvent.setup();
    setupClipboard();

    render(<LogDetailDialog open logId="log-123" onOpenChange={noop} />);

    await waitFor(() => {
      expect(
        screen.getAllByRole("button").some((b) => b.textContent?.includes("Share"))
      ).toBe(true);
    });

    const shareBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Share"))!;

    await user.click(shareBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Link copied to clipboard!");
    });
  });

  test("renders Close button alongside Share button", async () => {
    render(<LogDetailDialog open logId="log-123" onOpenChange={noop} />);

    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      expect(buttons.some((b) => b.textContent?.includes("Share"))).toBe(true);
      expect(buttons.some((b) => b.textContent?.includes("Close"))).toBe(true);
    });
  });

  test("Close button calls onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<LogDetailDialog open logId="log-123" onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(
        screen.getAllByRole("button").some((b) => b.textContent?.includes("Close"))
      ).toBe(true);
    });

    const closeBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Close"))!;

    await user.click(closeBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("Share button copies the URL that already contains logId param", async () => {
    // Simulate the URL having logId set by the parent page before the dialog opens
    setupWindowLocation(
      "http://localhost:3000/w/my-workspace/agent-logs?page=2&logId=xyz-789"
    );
    const user = userEvent.setup();
    const writeText = setupClipboard();

    render(<LogDetailDialog open logId="xyz-789" onOpenChange={noop} />);

    await waitFor(() => {
      expect(
        screen.getAllByRole("button").some((b) => b.textContent?.includes("Share"))
      ).toBe(true);
    });

    await user.click(
      screen.getAllByRole("button").find((b) => b.textContent?.includes("Share"))!
    );

    expect(writeText).toHaveBeenCalledWith(
      "http://localhost:3000/w/my-workspace/agent-logs?page=2&logId=xyz-789"
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Link copied to clipboard!");
    });
  });
});

// ---------------------------------------------------------------------------

describe("MessageBubble — newline rendering", () => {
  test("user message bubble retains whitespace-pre-wrap for newline rendering", async () => {
    const multilineContent = "Line one\nLine two\nLine three";
    global.fetch = makeStatsFetch([
      { role: "user", content: multilineContent },
    ]);

    render(<LogDetailDialog open logId="log-nl-1" onOpenChange={noop} />);

    await waitFor(() => {
      const p = document.querySelector("p.whitespace-pre-wrap");
      expect(p).not.toBeNull();
      expect(p?.textContent).toContain("Line one");
      expect(p?.textContent).toContain("Line two");
    });
  });

  test("user message bubble unescapes literal \\n sequences", async () => {
    global.fetch = makeStatsFetch([{ role: "user", content: "Line one\\nLine two" }]);
    render(<LogDetailDialog open logId="log-nl-2" onOpenChange={noop} />);
    await waitFor(() => {
      const p = document.querySelector("p.whitespace-pre-wrap");
      expect(p?.textContent).toContain("Line one");
      expect(p?.textContent).toContain("Line two");
      expect(p?.textContent).not.toContain("\\n");
    });
  });
});
