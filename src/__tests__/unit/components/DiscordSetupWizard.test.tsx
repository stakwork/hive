// @vitest-environment jsdom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before component imports
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "test-workspace" } }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
  }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked ?? false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor,
  }: {
    children: React.ReactNode;
    htmlFor?: string;
  }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    id,
    type,
    placeholder,
    value,
    onChange,
    disabled,
  }: {
    id?: string;
    type?: string;
    placeholder?: string;
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      type={type ?? "text"}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      className={className}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <span data-testid="loader" />,
  AlertTriangle: () => <span data-testid="alert-triangle" />,
  ExternalLink: () => <span data-testid="external-link" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}));

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.open = vi.fn();

// ---------------------------------------------------------------------------
// Import component under test (after mocks)
// ---------------------------------------------------------------------------

import { DiscordSetupWizard } from "@/components/settings/DiscordSetupWizard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  onComplete: vi.fn(),
};

function renderWizard(props = {}) {
  return render(<DiscordSetupWizard {...defaultProps} {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiscordSetupWizard — Step 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  it("renders Step 1 heading and token input", () => {
    renderWizard();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Bot Token")).toBeInTheDocument();
  });

  it("'Verify Token' button is disabled when input is empty", () => {
    renderWizard();
    const verifyBtn = screen.getByRole("button", { name: /verify token/i });
    expect(verifyBtn).toBeDisabled();
  });

  it("'Next →' button is disabled until token is validated", () => {
    renderWizard();
    const nextBtn = screen.getByRole("button", { name: /next →/i });
    expect(nextBtn).toBeDisabled();
  });

  it("shows error message when validate returns valid: false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false, error: "Invalid token — check the Developer Portal" }),
    });

    renderWizard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Bot Token"), "bad.token.here");
    await user.click(screen.getByRole("button", { name: /verify token/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid token — check the Developer Portal")).toBeInTheDocument();
    });
  });

  it("does NOT advance to Step 2 after a failed validate response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false, error: "Bad token" }),
    });

    renderWizard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Bot Token"), "bad.token.here");
    await user.click(screen.getByRole("button", { name: /verify token/i }));

    await waitFor(() => {
      expect(screen.getByText("Bad token")).toBeInTheDocument();
    });

    // Still on Step 1
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    const nextBtn = screen.getByRole("button", { name: /next →/i });
    expect(nextBtn).toBeDisabled();
  });

  it("advances to Step 2 after a successful validate response", async () => {
    // Mock validate endpoint
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, botUsername: "HiveTestBot", clientId: "1234567890" }),
      })
      // Mock PUT to save token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    renderWizard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Bot Token"), "valid.token.abc");
    await user.click(screen.getByRole("button", { name: /verify token/i }));

    await waitFor(() => {
      expect(screen.getByText(/token verified/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /next →/i }));

    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
  });
});

describe("DiscordSetupWizard — Step 2", () => {
  async function advanceToStep2() {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, botUsername: "HiveTestBot", clientId: "1234567890" }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    renderWizard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Bot Token"), "valid.token.abc");
    await user.click(screen.getByRole("button", { name: /verify token/i }));
    await waitFor(() => expect(screen.getByText(/token verified/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /next →/i }));
    await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeInTheDocument());
    return user;
  }

  it("shows MESSAGE_CONTENT intent instructions and warning", async () => {
    await advanceToStep2();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/without this intent enabled/i)).toBeInTheDocument();
  });

  it("advances to Step 3 without an API call", async () => {
    const user = await advanceToStep2();
    const callsBefore = mockFetch.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /done.*enabled it/i }));
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    expect(mockFetch.mock.calls.length).toBe(callsBefore); // no extra fetch
  });
});

describe("DiscordSetupWizard — Step 3", () => {
  async function advanceToStep3(clientId = "1234567890") {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, botUsername: "HiveTestBot", clientId }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    renderWizard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Bot Token"), "valid.token.abc");
    await user.click(screen.getByRole("button", { name: /verify token/i }));
    await waitFor(() => expect(screen.getByText(/token verified/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /next →/i }));
    await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /done.*enabled it/i }));
    await waitFor(() => expect(screen.getByText("Step 3 of 4")).toBeInTheDocument());
    return user;
  }

  it("shows error when /guilds returns empty array", async () => {
    const user = await advanceToStep3();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guilds: [] }),
    });

    await user.click(screen.getByRole("button", { name: /my bot is in the server/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/bot not found in any server/i)
      ).toBeInTheDocument();
    });

    // Still on Step 3
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
  });

  it("shows manual clientId input when clientId is null", async () => {
    // Pass null clientId from validate
    await advanceToStep3(null as unknown as string);

    // The manual input should be visible (labeled "Application / Client ID")
    expect(screen.getByLabelText(/application.*client id/i)).toBeInTheDocument();
  });

  it("does not show manual clientId input when clientId is present", async () => {
    await advanceToStep3("1234567890");
    expect(screen.queryByPlaceholderText(/application.*client id/i)).not.toBeInTheDocument();
  });

  it("advances to Step 4 when /guilds returns ≥ 1 guild", async () => {
    const user = await advanceToStep3();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        guilds: [
          {
            id: "111",
            name: "Hive Dev Server",
            channels: [
              { id: "222", name: "general", type: 0 },
              { id: "333", name: "engineering", type: 0 },
            ],
          },
        ],
      }),
    });

    await user.click(screen.getByRole("button", { name: /my bot is in the server/i }));

    await waitFor(() => {
      expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    });
  });
});

describe("DiscordSetupWizard — Step 4", () => {
  async function advanceToStep4() {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ valid: true, botUsername: "HiveTestBot", clientId: "1234567890" }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // guilds response
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          guilds: [
            {
              id: "111",
              name: "Hive Dev Server",
              channels: [
                { id: "222", name: "general", type: 0 },
                { id: "333", name: "engineering", type: 0 },
              ],
            },
          ],
        }),
      });

    renderWizard();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Bot Token"), "valid.token.abc");
    await user.click(screen.getByRole("button", { name: /verify token/i }));
    await waitFor(() => expect(screen.getByText(/token verified/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /next →/i }));
    await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /done.*enabled it/i }));
    await waitFor(() => expect(screen.getByText("Step 3 of 4")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /my bot is in the server/i }));
    await waitFor(() => expect(screen.getByText("Step 4 of 4")).toBeInTheDocument());

    return user;
  }

  it("renders guild and channel checkboxes", async () => {
    await advanceToStep4();
    expect(screen.getByText("Hive Dev Server")).toBeInTheDocument();
    expect(screen.getByText("#general")).toBeInTheDocument();
    expect(screen.getByText("#engineering")).toBeInTheDocument();
  });

  it("'Save & Finish' is disabled when no channels are selected", async () => {
    await advanceToStep4();
    const saveBtn = screen.getByRole("button", { name: /save & finish/i });
    expect(saveBtn).toBeDisabled();
  });

  it("'Save & Finish' is enabled after selecting at least one channel", async () => {
    const user = await advanceToStep4();

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);

    const saveBtn = screen.getByRole("button", { name: /save & finish/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls PUT discord-channels and PUT discord-integration on Save & Finish", async () => {
    const user = await advanceToStep4();

    // Select first channel
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);

    // Mock PUT discord-channels
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ channels: [] }) })
      // Mock PUT discord-integration
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await user.click(screen.getByRole("button", { name: /save & finish/i }));

    await waitFor(() => {
      expect(defaultProps.onComplete).toHaveBeenCalled();
    });

    const calls = mockFetch.mock.calls;
    const channelsPutCall = calls.find(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("discord-channels") &&
        opts?.method === "PUT"
    );
    expect(channelsPutCall).toBeDefined();

    // Find the PUT to discord-integration that sets discordEnabled: true (final step)
    const integrationEnableCalls = calls.filter(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("discord-integration") &&
        opts?.method === "PUT" &&
        (() => {
          try {
            return JSON.parse(opts.body as string).discordEnabled === true;
          } catch {
            return false;
          }
        })()
    );
    expect(integrationEnableCalls.length).toBeGreaterThan(0);
  });
});
