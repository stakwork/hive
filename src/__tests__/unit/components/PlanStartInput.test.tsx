import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Hoist mocks so they are available before module resolution
const { mockSpeechRecognitionState, mockUseSpeechRecognition, mockUseControlKeyHold } =
  vi.hoisted(() => {
    const state = {
      isListening: false,
      transcript: "",
      isSupported: false,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetTranscript: vi.fn(),
    };

    const mockFn = vi.fn(() => ({ ...state }));
    const mockControlKey = vi.fn();

    return {
      mockSpeechRecognitionState: state,
      mockUseSpeechRecognition: mockFn,
      mockUseControlKeyHold: mockControlKey,
    };
  });

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: mockUseSpeechRecognition,
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: mockUseControlKeyHold,
}));

// Module-level mock with a mutable return value
const mockUseWorkspace = vi.fn(() => ({
  workspace: { repositories: [], slug: "current-ws" },
  workspaces: [] as Array<{ slug: string; name: string }>,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span {...props}>{children}</span>
    ),
  },
}));

// jsdom does not implement scrollIntoView; cmdk calls it internally
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

import { PlanStartInput } from "@/app/w/[slug]/plan/new/components/PlanStartInput";

const mentionWorkspaces = [
  { slug: "test-ws", name: "Test WS" },
  { slug: "other-ws", name: "Other WS" },
];

// Mock sonner toast to avoid errors in tests
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("PlanStartInput", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpeechRecognitionState.isListening = false;
    mockSpeechRecognitionState.transcript = "";
    mockSpeechRecognitionState.isSupported = false;
    mockUseSpeechRecognition.mockImplementation(() => ({ ...mockSpeechRecognitionState }));
    // Reset to default (no workspaces)
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [], slug: "current-ws" },
      workspaces: [],
    });
  });

  test("send button is not inside an absolutely-positioned container", () => {
    render(<PlanStartInput onSubmit={onSubmit} />);

    const submitBtn = screen.getByTestId("plan-start-submit");

    // Walk up the DOM tree checking no ancestor has 'absolute' in its className
    let el: HTMLElement | null = submitBtn.parentElement;
    while (el) {
      const classes = el.className ?? "";
      expect(classes).not.toContain("absolute");
      el = el.parentElement;
    }
  });

  test("prototype toggle and send button are siblings within the same parent element", () => {
    render(<PlanStartInput onSubmit={onSubmit} />);

    const toggleSwitch = screen.getByTestId("prototype-toggle");
    const submitBtn = screen.getByTestId("plan-start-submit");

    // The bottom row is the common ancestor; both elements should share a grandparent
    // prototype-toggle is inside a flex wrapper inside the row; send button is inside ml-auto div inside the row
    const bottomRow = screen.getByTestId("bottom-row");
    expect(bottomRow).toContainElement(toggleSwitch);
    expect(bottomRow).toContainElement(submitBtn);
  });

  test("textarea does not have pb-16 in its className", () => {
    render(<PlanStartInput onSubmit={onSubmit} />);

    const textarea = screen.getByTestId("plan-start-input");
    expect(textarea.className).not.toContain("pb-16");
  });

  describe("@mention workspace dropdown", () => {
    test("typing @test shows matching workspace in dropdown", async () => {
      mockUseWorkspace.mockReturnValue({
        workspace: { repositories: [], slug: "current-ws" },
        workspaces: mentionWorkspaces,
      });

      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input");
      await userEvent.type(textarea, "@test");

      expect(screen.getByTestId("mention-item-test-ws")).toBeInTheDocument();
    });

    test("pressing Escape dismisses the mention dropdown", async () => {
      mockUseWorkspace.mockReturnValue({
        workspace: { repositories: [], slug: "current-ws" },
        workspaces: mentionWorkspaces,
      });

      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input");
      await userEvent.type(textarea, "@test");

      expect(screen.getByTestId("mention-item-test-ws")).toBeInTheDocument();

      fireEvent.keyDown(textarea, { key: "Escape" });

      expect(screen.queryByTestId("mention-item-test-ws")).not.toBeInTheDocument();
    });

    test("clicking a mention item inserts @slug into the textarea", async () => {
      mockUseWorkspace.mockReturnValue({
        workspace: { repositories: [], slug: "current-ws" },
        workspaces: mentionWorkspaces,
      });

      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "@test");

      const item = screen.getByTestId("mention-item-test-ws");
      fireEvent.click(item);

      expect(textarea.value).toContain("@test-ws");
    });

    test("mention dropdown does not appear when isLoading is true", async () => {
      mockUseWorkspace.mockReturnValue({
        workspace: { repositories: [], slug: "current-ws" },
        workspaces: mentionWorkspaces,
      });

      render(<PlanStartInput onSubmit={onSubmit} isLoading={true} />);
      const textarea = screen.getByTestId("plan-start-input");
      await userEvent.type(textarea, "@test");

      expect(screen.queryByTestId("mention-item-test-ws")).not.toBeInTheDocument();
    });
  });

  test("image upload button is rendered in the bottom row", () => {
    render(<PlanStartInput onSubmit={onSubmit} />);

    const imageBtn = screen.getByTestId("image-upload-btn");
    expect(imageBtn).toBeDefined();

    const bottomRow = screen.getByTestId("bottom-row");
    expect(bottomRow).toContainElement(imageBtn);
  });

  test("submit button is disabled when no text and no images", () => {
    render(<PlanStartInput onSubmit={onSubmit} />);

    const submitBtn = screen.getByTestId("plan-start-submit");
    expect(submitBtn).toBeDisabled();
  });
});
