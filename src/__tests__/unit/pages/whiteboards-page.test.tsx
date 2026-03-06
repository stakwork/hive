import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import WhiteboardsPage from "@/app/w/[slug]/whiteboards/page";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// Mock useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    id: "workspace-1",
    slug: "test-workspace",
  }),
}));

// Mock sonner toast
const mockToastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

// Mock UI components
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: any) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock("lucide-react", () => ({
  Plus: () => <span>plus</span>,
  Trash2: () => <span>trash</span>,
  Loader2: () => <span>loader</span>,
  PenLine: () => <span>penline</span>,
  Link2: () => <span>link2</span>,
}));

describe("WhiteboardsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadWhiteboards", () => {
    it("shows session expired message on 401 response", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      });

      render(<WhiteboardsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Session expired — please refresh the page.")
        ).toBeInTheDocument();
      });

      expect(screen.queryByText("No whiteboards yet")).not.toBeInTheDocument();
    });

    it("shows generic error message on 500 response", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      render(<WhiteboardsPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Failed to load whiteboards.")
        ).toBeInTheDocument();
        expect(
          screen.getByText("Error loading whiteboards")
        ).toBeInTheDocument();
      });

      expect(screen.queryByText("No whiteboards yet")).not.toBeInTheDocument();
    });

    it("renders whiteboard list and clears error on successful load", async () => {
      const mockWhiteboards = [
        {
          id: "wb-1",
          name: "My Whiteboard",
          featureId: null,
          feature: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: mockWhiteboards }),
      });

      render(<WhiteboardsPage />);

      await waitFor(() => {
        expect(screen.getByText("My Whiteboard")).toBeInTheDocument();
      });

      expect(
        screen.queryByText("Error loading whiteboards")
      ).not.toBeInTheDocument();
      expect(screen.queryByText("No whiteboards yet")).not.toBeInTheDocument();
    });
  });

  describe("handleCreate", () => {
    it("shows toast error when create request fails", async () => {
      // First call: loadWhiteboards succeeds with empty list
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        })
        // Second call: handleCreate fails
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({}),
        });

      render(<WhiteboardsPage />);

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.getByText("No whiteboards yet")).toBeInTheDocument();
      });

      const createButton = screen.getByRole("button", { name: /new whiteboard/i });
      await userEvent.click(createButton);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Failed to create whiteboard — please try again."
        );
      });

      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
