// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InsertLinkDialog } from "@/components/whiteboard/InsertLinkDialog";

// Minimal stubs for shadcn Dialog so we don't need the full radix setup
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    type,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
  }) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

describe("InsertLinkDialog", () => {
  const onOpenChange = vi.fn();
  const onInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    render(
      <InsertLinkDialog open={false} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("renders the dialog when open", () => {
    render(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    expect(screen.getByTestId("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("https://example.com")).toBeTruthy();
    expect(screen.getByPlaceholderText("Defaults to URL")).toBeTruthy();
  });

  it("shows validation error for invalid URL on submit", async () => {
    render(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    const urlInput = screen.getByPlaceholderText("https://example.com");
    await userEvent.type(urlInput, "not-a-url");
    fireEvent.submit(urlInput.closest("form")!);
    await waitFor(() => {
      expect(
        screen.getByText(/please enter a valid url/i)
      ).toBeTruthy();
    });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("calls onInsert with url and label when both are provided", async () => {
    render(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    const urlInput = screen.getByPlaceholderText("https://example.com");
    const labelInput = screen.getByPlaceholderText("Defaults to URL");

    await userEvent.type(urlInput, "https://example.com");
    await userEvent.type(labelInput, "My Link");
    fireEvent.submit(urlInput.closest("form")!);

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith("https://example.com", "My Link");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("defaults label to url when label is blank", async () => {
    render(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    const urlInput = screen.getByPlaceholderText("https://example.com");

    await userEvent.type(urlInput, "https://example.com");
    fireEvent.submit(urlInput.closest("form")!);

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith("https://example.com", "https://example.com");
    });
  });

  it("closes and clears fields when Cancel is clicked", async () => {
    render(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    const urlInput = screen.getByPlaceholderText("https://example.com");
    await userEvent.type(urlInput, "https://example.com");

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("resets fields when dialog transitions from open to closed", async () => {
    const { rerender } = render(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    const urlInput = screen.getByPlaceholderText("https://example.com");
    await userEvent.type(urlInput, "https://example.com");

    // Close dialog
    rerender(
      <InsertLinkDialog open={false} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    // Re-open
    rerender(
      <InsertLinkDialog open={true} onOpenChange={onOpenChange} onInsert={onInsert} />
    );
    expect((screen.getByPlaceholderText("https://example.com") as HTMLInputElement).value).toBe("");
  });
});
