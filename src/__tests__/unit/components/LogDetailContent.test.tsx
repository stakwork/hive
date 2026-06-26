// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks ---

vi.mock("gpt-tokenizer", () => ({
  encode: (text: string) => Array.from(text),
}));

vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "UTC" }),
}));

vi.mock("@/lib/date-utils", () => ({
  formatInUserTz: (date: Date) => date.toISOString(),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <span data-testid="loader" />,
  User: () => <span data-testid="icon-user" />,
  Bot: () => <span data-testid="icon-bot" />,
  Wrench: () => <span data-testid="icon-wrench" />,
  Code2: () => <span data-testid="icon-code" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
  Flag: () => <span data-testid="icon-flag" />,
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

vi.mock("@/lib/utils/agent-log-pairing", () => ({
  buildToolCallIndex: vi.fn(() => new Map()),
  getConsumedResultIds: vi.fn(() => new Set()),
}));

import {
  unescapeLogString,
  SystemMessageBubble,
  ToolCallItem,
  MessageBubble,
  CopyButton,
  LogDetailContent,
  getToolResultValue,
  extractReasoning,
  extractTextContent,
} from "@/components/agent-logs/LogDetailContent";
import type { ParsedMessage } from "@/lib/utils/agent-log-stats";

// ─── unescapeLogString ────────────────────────────────────────────────────────

describe("unescapeLogString", () => {
  test("unescapes \\n to real newline", () => {
    expect(unescapeLogString("line one\\nline two")).toBe("line one\nline two");
  });

  test("unescapes \\t to real tab", () => {
    expect(unescapeLogString("col1\\tcol2")).toBe("col1\tcol2");
  });

  test('unescapes \\" to double quote', () => {
    expect(unescapeLogString('say \\"hi\\"')).toBe('say "hi"');
  });

  test("leaves already-unescaped single quotes unchanged", () => {
    expect(unescapeLogString("it's fine")).toBe("it's fine");
  });

  test("returns empty string unchanged", () => {
    expect(unescapeLogString("")).toBe("");
  });

  test("handles multiple escape sequences in one string", () => {
    expect(unescapeLogString("a\\nb\\tc")).toBe("a\nb\tc");
  });
});

// ─── extractReasoning ────────────────────────────────────────────────────────

describe("extractReasoning", () => {
  test("returns joined text from multiple reasoning parts in content[]", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Step one." },
        { type: "reasoning", text: "Step two." },
        { type: "text", text: "Answer." },
      ],
    };
    expect(extractReasoning(msg)).toBe("Step one.\nStep two.");
  });

  test("falls back to top-level reasoning string when no reasoning parts in array", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Answer." }],
      reasoning: "top-level reasoning fallback",
    };
    expect(extractReasoning(msg)).toBe("top-level reasoning fallback");
  });

  test("returns null when neither reasoning parts nor top-level reasoning exist", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Answer." }],
    };
    expect(extractReasoning(msg)).toBeNull();
  });

  test("returns null for string content with no top-level reasoning", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: "just a string",
    };
    expect(extractReasoning(msg)).toBeNull();
  });

  test("never reads providerOptions or signature fields", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "Answer." }],
      providerOptions: { anthropic: { signature: "secret" } },
    } as ParsedMessage & { providerOptions: unknown };
    // extractReasoning should not see any providerOptions content
    expect(extractReasoning(msg)).toBeNull();
  });
});

// ─── extractTextContent ───────────────────────────────────────────────────────

describe("extractTextContent", () => {
  test("no longer returns the top-level reasoning field as fallback", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [],
      reasoning: "this is reasoning only",
    };
    // extractTextContent should return null, not the reasoning string
    expect(extractTextContent(msg)).toBeNull();
  });

  test("still returns string content", () => {
    const msg: ParsedMessage = { role: "assistant", content: "plain text" };
    expect(extractTextContent(msg)).toBe("plain text");
  });

  test("still returns text parts from content array", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "answer" },
      ],
    };
    expect(extractTextContent(msg)).toBe("answer");
  });

  test("returns null when content array has only reasoning parts", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [{ type: "reasoning", text: "only reasoning" }],
    };
    expect(extractTextContent(msg)).toBeNull();
  });
});

// ─── SystemMessageBubble ─────────────────────────────────────────────────────

describe("SystemMessageBubble", () => {
  const systemMessage: ParsedMessage = {
    role: "system",
    content: "You are a helpful assistant. Do things carefully.",
  };

  test("renders collapsed by default — body not visible", () => {
    render(<SystemMessageBubble message={systemMessage} />);
    // Header should be visible
    expect(screen.getByText("System prompt")).toBeTruthy();
    // Chevron right = collapsed
    expect(screen.getByTestId("chevron-right")).toBeTruthy();
    // Body content should not be rendered
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  test("expands body on click", async () => {
    const user = userEvent.setup();
    render(<SystemMessageBubble message={systemMessage} />);
    const btn = screen.getByRole("button");
    await user.click(btn);
    // After click, markdown body should appear
    expect(screen.getByTestId("markdown")).toBeTruthy();
    expect(screen.getByTestId("chevron-down")).toBeTruthy();
  });

  test("collapses again on second click", async () => {
    const user = userEvent.setup();
    render(<SystemMessageBubble message={systemMessage} />);
    const btn = screen.getByRole("button");
    await user.click(btn);
    expect(screen.getByTestId("markdown")).toBeTruthy();
    await user.click(btn);
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  test("shows token count badge", () => {
    render(<SystemMessageBubble message={systemMessage} />);
    const badge = screen.getByTestId("badge");
    expect(badge.textContent).toContain("tokens");
  });
});

// ─── ToolCallItem ─────────────────────────────────────────────────────────────

describe("ToolCallItem", () => {
  const tc = { id: "call-1", name: "bash", args: '{"cmd":"ls"}' };

  test("renders tool name", () => {
    render(<ToolCallItem tc={tc} />);
    expect(screen.getByText("bash")).toBeTruthy();
  });

  test("args are visible by default (expanded)", () => {
    render(<ToolCallItem tc={tc} />);
    // The pre block with args should be present on initial render
    expect(screen.getByText(/ls/)).toBeTruthy();
  });

  test("args collapse after clicking the header button", async () => {
    const user = userEvent.setup();
    render(<ToolCallItem tc={tc} />);
    // Initially expanded — find the hide label
    expect(screen.getByText(/\(hide\)/)).toBeTruthy();
    // Click to collapse
    const btn = screen.getByRole("button", { name: /Called/ });
    await user.click(btn);
    expect(screen.queryByText(/ls/)).toBeNull();
    expect(screen.getByText(/\(show\)/)).toBeTruthy();
  });

  test("renders copy button when args present", () => {
    render(<ToolCallItem tc={tc} />);
    expect(screen.getByTestId("icon-copy")).toBeTruthy();
  });

  test("no copy button when args is null", () => {
    render(<ToolCallItem tc={{ id: "x", name: "noop", args: null }} />);
    expect(screen.queryByTestId("icon-copy")).toBeNull();
  });

  test("renders paired result section when pairedResult provided", () => {
    const pairedResult = {
      type: "tool-result" as const,
      toolCallId: "call-1",
      output: "result output",
    };
    render(<ToolCallItem tc={tc} pairedResult={pairedResult} />);
    expect(screen.getByText(/Result/)).toBeTruthy();
  });

  test("paired result is collapsed by default", () => {
    const pairedResult = {
      type: "tool-result" as const,
      toolCallId: "call-1",
      output: "secret result",
    };
    render(<ToolCallItem tc={tc} pairedResult={pairedResult} />);
    // "Result (show)" button visible but pre block with result content not rendered yet
    expect(screen.getByText(/Result/)).toBeTruthy();
    expect(screen.queryByText("secret result")).toBeNull();
  });

  test("paired result expands on click", async () => {
    const user = userEvent.setup();
    const pairedResult = {
      type: "tool-result" as const,
      toolCallId: "call-1",
      output: "expanded result",
    };
    render(<ToolCallItem tc={tc} pairedResult={pairedResult} />);
    const resultBtn = screen.getByRole("button", { name: /Result/ });
    await user.click(resultBtn);
    expect(screen.getByText("expanded result")).toBeTruthy();
  });
});

// ─── CopyButton ───────────────────────────────────────────────────────────────

describe("CopyButton", () => {
  // userEvent.setup() installs its own clipboard stub — spy on writeText AFTER setup()
  function setupClipboard() {
    const user = userEvent.setup();
    const writeSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    return { user, writeSpy };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calls navigator.clipboard.writeText with the provided value", async () => {
    const { user, writeSpy } = setupClipboard();
    render(<CopyButton value="copy me" />);
    const btn = screen.getByRole("button", { name: /Copy/ });
    await user.click(btn);
    expect(writeSpy).toHaveBeenCalledWith("copy me");
  });

  test("shows Check icon after copy", async () => {
    const { user } = setupClipboard();
    render(<CopyButton value="test" />);
    await user.click(screen.getByRole("button", { name: /Copy/ }));
    // Should now show check icon
    expect(screen.getByTestId("icon-check")).toBeTruthy();
  });

  test("stops propagation so parent toggle is not triggered", async () => {
    setupClipboard();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CopyButton value="test" />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    expect(parentClick).not.toHaveBeenCalled();
  });
});

// ─── MessageBubble ────────────────────────────────────────────────────────────

describe("MessageBubble — system role", () => {
  test("renders SystemMessageBubble for role=system", () => {
    const msg: ParsedMessage = { role: "system", content: "You are an AI." };
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("System prompt")).toBeTruthy();
  });
});

describe("MessageBubble — assistant long text truncation", () => {
  const longText = "A".repeat(2000);
  const msg: ParsedMessage = { role: "assistant", content: longText };

  test("truncates text over 1500 chars with Show more button", () => {
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("Show more")).toBeTruthy();
    // The rendered markdown should have truncated content (1500 chars)
    const markdownEl = screen.getByTestId("markdown");
    expect((markdownEl.textContent?.length ?? 0)).toBeLessThanOrEqual(1500);
  });

  test("expands to full text after clicking Show more", async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={msg} />);
    await user.click(screen.getByText("Show more"));
    expect(screen.getByText("Show less")).toBeTruthy();
    const markdownEl = screen.getByTestId("markdown");
    expect(markdownEl.textContent?.length).toBe(2000);
  });

  test("collapses again after clicking Show less", async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={msg} />);
    await user.click(screen.getByText("Show more"));
    await user.click(screen.getByText("Show less"));
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  test("short assistant text has no Show more button", () => {
    const shortMsg: ParsedMessage = { role: "assistant", content: "Short text." };
    render(<MessageBubble message={shortMsg} />);
    expect(screen.queryByText("Show more")).toBeNull();
  });

  test("short assistant text has no Show more button (recheck)", () => {
    const shortMsg: ParsedMessage = { role: "assistant", content: "Short." };
    render(<MessageBubble message={shortMsg} />);
    expect(screen.queryByText("Show more")).toBeNull();
  });
});

describe("MessageBubble — user long text truncation", () => {
  const longText = "B".repeat(2000);
  const msg: ParsedMessage = { role: "user", content: longText };

  test("truncates user text over 1500 chars with Show more button", () => {
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("Show more")).toBeTruthy();
    const para = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent?.length ?? 0) <= 1500);
    expect(para).toBeTruthy();
  });

  test("expands user message to full text after clicking Show more", async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={msg} />);
    await user.click(screen.getByText("Show more"));
    expect(screen.getByText("Show less")).toBeTruthy();
    expect(screen.getByText(longText)).toBeTruthy();
  });

  test("collapses user message again after clicking Show less", async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={msg} />);
    await user.click(screen.getByText("Show more"));
    await user.click(screen.getByText("Show less"));
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  test("short user message has no Show more button", () => {
    const shortMsg: ParsedMessage = { role: "user", content: "Short user text." };
    render(<MessageBubble message={shortMsg} />);
    expect(screen.queryByText("Show more")).toBeNull();
  });
});

describe("MessageBubble — tool result (Vercel AI SDK) skips consumed ids", () => {
  test("returns null when all tool results are consumed", () => {
    const msg: ParsedMessage = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call-1", output: "output" }],
    };
    const consumed = new Set(["call-1"]);
    const { container } = render(
      <MessageBubble message={msg} consumedResultIds={consumed} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders unpaired tool results (not in consumed set)", () => {
    const msg: ParsedMessage = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call-99", output: "unpaired" }],
    };
    const consumed = new Set(["call-1"]); // call-99 not consumed
    render(<MessageBubble message={msg} consumedResultIds={consumed} />);
    expect(screen.getByText(/1 tool result/)).toBeTruthy();
  });
});

describe("MessageBubble — tool result (OpenAI style) skips consumed ids", () => {
  test("returns null when tool_call_id is consumed", () => {
    const msg: ParsedMessage = {
      role: "tool",
      tool_call_id: "oai-1",
      content: "oai output",
    };
    const consumed = new Set(["oai-1"]);
    const { container } = render(
      <MessageBubble message={msg} consumedResultIds={consumed} />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders when tool_call_id is not consumed", () => {
    const msg: ParsedMessage = {
      role: "tool",
      tool_call_id: "oai-99",
      content: "standalone output",
    };
    const consumed = new Set(["oai-1"]);
    render(<MessageBubble message={msg} consumedResultIds={consumed} />);
    expect(screen.getByText(/1 tool result/)).toBeTruthy();
  });
});

describe("MessageBubble — tool call with paired result", () => {
  test("passes paired result to ToolCallItem from toolCallIndex", () => {
    const msg: ParsedMessage = {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { cmd: "ls" } },
      ],
    };
    const pairedResult = { type: "tool-result" as const, toolCallId: "call-1", output: "paired!" };
    const toolCallIndex = new Map([["call-1", pairedResult]]);
    render(<MessageBubble message={msg} toolCallIndex={toolCallIndex} />);
    // ToolCallItem should show the paired result section
    expect(screen.getByText(/Result/)).toBeTruthy();
  });
});

// ─── LogDetailContent integration ────────────────────────────────────────────

describe("LogDetailContent", () => {
  test("renders loading spinner", () => {
    render(
      <LogDetailContent
        conversation={null}
        stats={null}
        rawContent=""
        loading={true}
        error={null}
      />,
    );
    expect(screen.getByTestId("loader")).toBeTruthy();
  });

  test("renders error message", () => {
    render(
      <LogDetailContent
        conversation={null}
        stats={null}
        rawContent=""
        loading={false}
        error="Something went wrong"
      />,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  test("renders raw content when no conversation parsed", () => {
    render(
      <LogDetailContent
        conversation={null}
        stats={null}
        rawContent="raw log data here"
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("raw log data here")).toBeTruthy();
  });

  test("renders conversation messages", () => {
    const conversation: ParsedMessage[] = [
      { role: "user", content: "Hello agent" },
      { role: "assistant", content: "Hello user" },
    ];
    render(
      <LogDetailContent
        conversation={conversation}
        stats={null}
        rawContent=""
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("Hello agent")).toBeTruthy();
    expect(screen.getByText("Hello user")).toBeTruthy();
  });

  test("system message in conversation renders collapsed", () => {
    const conversation: ParsedMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];
    render(
      <LogDetailContent
        conversation={conversation}
        stats={null}
        rawContent=""
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText("System prompt")).toBeTruthy();
    // System body not shown initially
    expect(screen.queryByText("You are helpful.")).toBeNull();
  });
});

// ─── MessageBubble — flag button ──────────────────────────────────────────────

describe("MessageBubble — flag button", () => {
  const userMsg: ParsedMessage = { role: "user", content: "Hello agent" };
  const assistantMsg: ParsedMessage = { role: "assistant", content: "Hello user" };
  const systemMsg: ParsedMessage = { role: "system", content: "You are helpful." };
  const toolMsg: ParsedMessage = {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "id1", toolName: "bash", output: "ok" }],
  };
  const toolOnlyAssistantMsg: ParsedMessage = {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "tc1", toolName: "bash", input: { cmd: "ls" } }],
  };

  test("renders flag button for assistant message with text when onFlag provided", () => {
    const onFlag = vi.fn();
    render(<MessageBubble message={assistantMsg} onFlag={onFlag} />);
    expect(screen.getByTestId("icon-flag")).toBeTruthy();
  });

  test("renders flag button for tool-only assistant message when onFlag provided", () => {
    const onFlag = vi.fn();
    render(<MessageBubble message={toolOnlyAssistantMsg} onFlag={onFlag} />);
    expect(screen.getByTestId("icon-flag")).toBeTruthy();
  });

  test("does NOT render flag button for user message even when onFlag provided", () => {
    const onFlag = vi.fn();
    render(<MessageBubble message={userMsg} onFlag={onFlag} />);
    expect(screen.queryByTestId("icon-flag")).toBeNull();
  });

  test("does not render flag button when onFlag is omitted for assistant message", () => {
    render(<MessageBubble message={assistantMsg} />);
    expect(screen.queryByTestId("icon-flag")).toBeNull();
  });

  test("does not render flag button for system message even when onFlag provided", () => {
    const onFlag = vi.fn();
    render(<MessageBubble message={systemMsg} onFlag={onFlag} />);
    expect(screen.queryByTestId("icon-flag")).toBeNull();
  });

  test("does not render flag button for tool-result message even when onFlag provided", () => {
    const onFlag = vi.fn();
    render(<MessageBubble message={toolMsg} onFlag={onFlag} />);
    expect(screen.queryByTestId("icon-flag")).toBeNull();
  });

  test("calls onFlag when flag button clicked on assistant message", async () => {
    const user = userEvent.setup();
    const onFlag = vi.fn();
    render(<MessageBubble message={assistantMsg} onFlag={onFlag} />);
    const flagButton = screen.getByTestId("icon-flag").closest("button")!;
    await user.click(flagButton);
    expect(onFlag).toHaveBeenCalledTimes(1);
  });

  test("calls onFlag when flag button clicked on tool-only assistant message", async () => {
    const user = userEvent.setup();
    const onFlag = vi.fn();
    render(<MessageBubble message={toolOnlyAssistantMsg} onFlag={onFlag} />);
    const flagButton = screen.getByTestId("icon-flag").closest("button")!;
    await user.click(flagButton);
    expect(onFlag).toHaveBeenCalledTimes(1);
  });
});
