import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvitePopover } from "@/components/plan/InvitePopover";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock UI components
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: any) => (open ? <div data-testid="popover">{children}</div> : null),
  PopoverTrigger: ({ children }: any) => <div data-testid="popover-trigger">{children}</div>,
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div data-testid="command">{children}</div>,
  CommandInput: ({ placeholder }: any) => (
    <input data-testid="command-input" placeholder={placeholder} />
  ),
  CommandList: ({ children }: any) => <div data-testid="command-list">{children}</div>,
  CommandEmpty: ({ children }: any) => <div data-testid="command-empty">{children}</div>,
  CommandGroup: ({ children }: any) => <div data-testid="command-group">{children}</div>,
  CommandItem: ({ children, onSelect, value }: any) => (
    <div role="option" data-testid={`command-item-${value}`} onClick={onSelect}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, "data-testid": testId }: any) => (
    <button
      data-testid={testId ?? (variant === "outline" ? "cancel-button" : "send-invite-button")}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: ({ src, alt }: any) => <img data-testid="avatar-image" src={src} alt={alt} />,
  AvatarFallback: ({ children }: any) => <div data-testid="avatar-fallback">{children}</div>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMember = (id: string, name: string, alias: string) => ({
  user: { id, name, email: `${alias}@example.com`, image: null, sphinxAlias: alias, lightningPubkey: `pk-${id}` },
  role: "DEVELOPER",
});

const membersResponse = (...members: ReturnType<typeof makeMember>[]) => ({
  success: true,
  members,
  owner: null,
});

function mockFetchMembers(...members: ReturnType<typeof makeMember>[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => membersResponse(...members),
  });
}

function mockFetchInviteSuccess(sent: number, failed = 0) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, sent, failed }),
  });
}

function mockFetchInvitePartialFailure(sent: number, failed: number) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, sent, failed }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InvitePopover", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceSlug: "test-workspace",
    featureId: "feature-123",
    children: <div>Trigger</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  test("renders member list when Sphinx-linked members exist", async () => {
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"), makeMember("user-2", "Bob Jones", "bob_jones"));

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
      expect(screen.getByText("@alice")).toBeInTheDocument();
      expect(screen.getByText("Bob Jones")).toBeInTheDocument();
      expect(screen.getByText("@bob_jones")).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspaces/test-workspace/members?sphinxLinkedOnly=true"
    );
  });

  test("shows empty state when no Sphinx-linked members exist", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, members: [], owner: null }),
    });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("command-empty")).toBeInTheDocument();
      expect(screen.getByText("No Sphinx-linked members found")).toBeInTheDocument();
    });
  });

  test("does not show send button when no member is selected", async () => {
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("send-invite-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("cancel-button")).toBeInTheDocument();
  });

  test("shows send button after selecting a member", async () => {
    const user = userEvent.setup();
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toBeInTheDocument();
    });
  });

  test("toggles member off when selected again", async () => {
    const user = userEvent.setup();
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    const item = screen.getByText("Alice Smith").closest('[role="option"]')!;

    // Select
    await user.click(item);
    await waitFor(() => expect(screen.getByTestId("send-invite-button")).toBeInTheDocument());

    // Deselect
    await user.click(item);
    await waitFor(() => expect(screen.queryByTestId("send-invite-button")).not.toBeInTheDocument());
  });

  test("button label shows 'Send Invite' for 1 selected", async () => {
    const user = userEvent.setup();
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));

    render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toHaveTextContent("Send Invite");
    });
  });

  test("button label shows 'Send Invite' for 2 selected", async () => {
    const user = userEvent.setup();
    mockFetchMembers(
      makeMember("user-1", "Alice Smith", "alice"),
      makeMember("user-2", "Bob Jones", "bob")
    );

    render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);
    await user.click(screen.getByText("Bob Jones").closest('[role="option"]')!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toHaveTextContent("Send Invite");
    });
  });

  test("selecting a 4th member is silently ignored", async () => {
    const user = userEvent.setup();
    mockFetchMembers(
      makeMember("user-1", "Alice Smith", "alice"),
      makeMember("user-2", "Bob Jones", "bob"),
      makeMember("user-3", "Carol White", "carol"),
      makeMember("user-4", "Dave Brown", "dave")
    );

    render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);
    await user.click(screen.getByText("Bob Jones").closest('[role="option"]')!);
    await user.click(screen.getByText("Carol White").closest('[role="option"]')!);

    // 3 selected — button should say "Send Invite"
    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toHaveTextContent("Send Invite");
    });

    // Click 4th — should stay at 3 (button label still "Send Invite")
    await user.click(screen.getByText("Dave Brown").closest('[role="option"]')!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toHaveTextContent("Send Invite");
    });
  });

  test("sends invites with inviteeUserIds array and shows success toast", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    mockFetchMembers(
      makeMember("user-1", "Alice Smith", "alice"),
      makeMember("user-2", "Bob Jones", "bob")
    );
    mockFetchInviteSuccess(2);

    render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);
    await user.click(screen.getByText("Bob Jones").closest('[role="option"]')!);
    await user.click(screen.getByTestId("send-invite-button"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("inviteeUserIds"),
      });
      expect(toast.success).toHaveBeenCalledWith("2 invites sent!");
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  test("shows partial failure toast when API returns failed > 0", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    mockFetchMembers(
      makeMember("user-1", "Alice Smith", "alice"),
      makeMember("user-2", "Bob Jones", "bob")
    );
    mockFetchInvitePartialFailure(1, 1);

    render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);
    await user.click(screen.getByText("Bob Jones").closest('[role="option"]')!);
    await user.click(screen.getByTestId("send-invite-button"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("1 of 2 invites failed");
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  test("success toast uses singular 'invite' for a single send", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));
    mockFetchInviteSuccess(1);

    render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);
    await user.click(screen.getByTestId("send-invite-button"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("1 invite sent!");
    });
  });

  test("selections reset when popover closes", async () => {
    const user = userEvent.setup();
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));

    const { rerender } = render(<InvitePopover {...defaultProps} />);
    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    await user.click(screen.getByText("Alice Smith").closest('[role="option"]')!);
    await waitFor(() => expect(screen.getByTestId("send-invite-button")).toBeInTheDocument());

    // Close the popover
    rerender(<InvitePopover {...defaultProps} open={false} />);

    // Re-open — fetch members again
    mockFetchMembers(makeMember("user-1", "Alice Smith", "alice"));
    rerender(<InvitePopover {...defaultProps} open={true} />);

    await waitFor(() => expect(screen.getByText("Alice Smith")).toBeInTheDocument());

    // Send button should not be visible (selections were reset)
    expect(screen.queryByTestId("send-invite-button")).not.toBeInTheDocument();
  });

  test("closes popover when cancel is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, members: [], owner: null }),
    });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => expect(screen.getByTestId("cancel-button")).toBeInTheDocument());

    await user.click(screen.getByTestId("cancel-button"));

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  test("does not render when open is false", () => {
    render(<InvitePopover {...defaultProps} open={false} />);
    expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
  });
});
