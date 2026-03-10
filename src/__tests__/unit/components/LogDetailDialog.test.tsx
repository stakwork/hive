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
