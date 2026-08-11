// @vitest-environment jsdom
/**
 * Regression tests for DashboardChat/ChatInput drag overlay.
 * The original bug: dragCounterRef drifted non-zero and permanently
 * wedged the overlay open. After migration to useFileDrop the counter
 * is maintained in the shared hook with proper window-level self-heal.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ChatInput } from "@/components/dashboard/DashboardChat/ChatInput";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspaces: [],
    id: "ws-1",
    slug: "ws-1",
    workspace: null,
    switchWorkspace: vi.fn(),
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, disabled, ...props }: any) => (
    <button onClick={onClick} type={type} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children, asChild }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandInput: (props: any) => <input {...props} />,
  CommandList: ({ children }: any) => <div>{children}</div>,
  CommandEmpty: ({ children }: any) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: any) => (
    <div onClick={onSelect}>{children}</div>
  ),
}));

vi.mock("@/components/dashboard/DashboardChat/WorkspacePills", () => ({
  WorkspacePills: () => null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createDataTransfer(files: File[]) {
  return {
    files: Object.assign([...files], {
      length: files.length,
      item: (i: number) => files[i],
    }),
    types: ["Files"],
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  } as unknown as DataTransfer;
}

const baseProps = {
  onSend: vi.fn().mockResolvedValue(undefined),
  disabled: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DashboardChat/ChatInput — drag overlay regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows overlay on dragenter", () => {
    render(<ChatInput {...baseProps} />);
    const form = document.querySelector("form")!;

    fireEvent.dragEnter(form, { dataTransfer: createDataTransfer([]) });

    expect(screen.getByText("Drop image here")).toBeInTheDocument();
  });

  it("hides overlay after drop — overlay does not get stuck", async () => {
    const onImageUpload = vi.fn();
    render(<ChatInput {...baseProps} onImageUpload={onImageUpload} />);
    const form = document.querySelector("form")!;

    const file = new File(["img"], "photo.png", { type: "image/png" });
    const dt = createDataTransfer([file]);

    fireEvent.dragEnter(form, { dataTransfer: dt });
    expect(screen.getByText("Drop image here")).toBeInTheDocument();

    fireEvent.drop(form, { dataTransfer: dt });

    await waitFor(() => {
      expect(screen.queryByText("Drop image here")).not.toBeInTheDocument();
    });
  });

  it("overlay clears when drag is cancelled (window drop event) — counter-drift regression", async () => {
    render(<ChatInput {...baseProps} />);
    const form = document.querySelector("form")!;

    // Enter multiple times (simulates nested children) — old code would drift counter
    fireEvent.dragEnter(form, { dataTransfer: createDataTransfer([]) });
    fireEvent.dragEnter(form, { dataTransfer: createDataTransfer([]) });
    fireEvent.dragEnter(form, { dataTransfer: createDataTransfer([]) });

    expect(screen.getByText("Drop image here")).toBeInTheDocument();

    // Simulate drag cancelled via window drop (e.g. dropped outside browser)
    act(() => {
      window.dispatchEvent(new Event("drop", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Drop image here")).not.toBeInTheDocument();
    });
  });

  it("overlay clears on window dragend event", async () => {
    render(<ChatInput {...baseProps} />);
    const form = document.querySelector("form")!;

    fireEvent.dragEnter(form, { dataTransfer: createDataTransfer([]) });
    expect(screen.getByText("Drop image here")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("dragend", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Drop image here")).not.toBeInTheDocument();
    });
  });

  it("does not trigger upload when disabled", async () => {
    const onImageUpload = vi.fn();
    render(<ChatInput {...baseProps} disabled={true} onImageUpload={onImageUpload} />);
    const form = document.querySelector("form")!;

    const file = new File(["img"], "photo.png", { type: "image/png" });
    fireEvent.drop(form, { dataTransfer: createDataTransfer([file]) });

    await waitFor(() => {
      expect(onImageUpload).not.toHaveBeenCalled();
    });
  });

  it("dragging across nested children does not flicker overlay", () => {
    render(<ChatInput {...baseProps} />);
    const form = document.querySelector("form")!;
    const dt = createDataTransfer([]);

    fireEvent.dragEnter(form, { dataTransfer: dt });
    expect(screen.getByText("Drop image here")).toBeInTheDocument();

    // Enter/leave nested element — overlay must stay
    const nested = form.querySelector("textarea") ?? form.firstElementChild!;
    fireEvent.dragEnter(nested as Element, { dataTransfer: dt });
    fireEvent.dragLeave(nested as Element, { dataTransfer: dt });

    // Overlay still visible
    expect(screen.getByText("Drop image here")).toBeInTheDocument();
  });
});
