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
  Button: ({ children, onClick, disabled, variant, size }: any) => (
    <button
      data-testid={variant === "outline" ? "cancel-button" : "send-invite-button"}
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
    const mockMembers = {
      success: true,
      members: [
        {
          user: {
            id: "user-1",
            name: "Alice Smith",
            email: "alice@example.com",
            image: null,
            sphinxAlias: "alice",
            lightningPubkey: "pubkey1",
          },
          role: "DEVELOPER",
        },
        {
          user: {
            id: "user-2",
            name: "Bob Jones",
            email: "bob@example.com",
            image: "https://example.com/bob.jpg",
            sphinxAlias: "bob_jones",
            lightningPubkey: "pubkey2",
          },
          role: "PM",
        },
      ],
      owner: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockMembers,
    });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });

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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        members: [
          {
            user: {
              id: "user-1",
              name: "Alice Smith",
              email: "alice@example.com",
              image: null,
              sphinxAlias: "alice",
              lightningPubkey: "pubkey1",
            },
            role: "DEVELOPER",
          },
        ],
        owner: null,
      }),
    });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    // Send button should not be visible when no selection
    expect(screen.queryByTestId("send-invite-button")).not.toBeInTheDocument();
    // Cancel button should always be visible
    expect(screen.getByTestId("cancel-button")).toBeInTheDocument();
  });

  test("shows send button after member selection", async () => {
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        members: [
          {
            user: {
              id: "user-1",
              name: "Alice Smith",
              email: "alice@example.com",
              image: null,
              sphinxAlias: "alice",
              lightningPubkey: "pubkey1",
            },
            role: "DEVELOPER",
          },
        ],
        owner: null,
      }),
    });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    const memberItem = screen.getByText("Alice Smith").closest('[role="option"]');
    await user.click(memberItem!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toBeInTheDocument();
    });
  });

  test("sends invite and shows success toast", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          members: [
            {
              user: {
                id: "user-1",
                name: "Alice Smith",
                email: "alice@example.com",
                image: null,
                sphinxAlias: "alice",
                lightningPubkey: "pubkey1",
              },
              role: "DEVELOPER",
            },
          ],
          owner: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    const memberItem = screen.getByText("Alice Smith").closest('[role="option"]');
    await user.click(memberItem!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toBeInTheDocument();
    });

    const sendButton = screen.getByTestId("send-invite-button");
    await user.click(sendButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeUserId: "user-1" }),
      });
    });

    expect(toast.success).toHaveBeenCalledWith("Invite sent!");
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  test("shows error toast when invite fails", async () => {
    const user = userEvent.setup();
    const { toast } = await import("sonner");

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          members: [
            {
              user: {
                id: "user-1",
                name: "Alice Smith",
                email: "alice@example.com",
                image: null,
                sphinxAlias: "alice",
                lightningPubkey: "pubkey1",
              },
              role: "DEVELOPER",
            },
          ],
          owner: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Failed to send invite" }),
      });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    });

    const memberItem = screen.getByText("Alice Smith").closest('[role="option"]');
    await user.click(memberItem!);

    await waitFor(() => {
      expect(screen.getByTestId("send-invite-button")).toBeInTheDocument();
    });

    const sendButton = screen.getByTestId("send-invite-button");
    await user.click(sendButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to send invite");
    });

    expect(defaultProps.onOpenChange).not.toHaveBeenCalled();
  });

  test("closes popover when cancel is clicked", async () => {
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, members: [], owner: null }),
    });

    render(<InvitePopover {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("cancel-button")).toBeInTheDocument();
    });

    const cancelButton = screen.getByTestId("cancel-button");
    await user.click(cancelButton);

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  test("does not render when open is false", () => {
    render(<InvitePopover {...defaultProps} open={false} />);

    expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
  });
});
