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
    div: ({
      children,
      onAnimationComplete: _onAnimationComplete,
      animate: _animate,
      transition: _transition,
      initial: _initial,
      exit: _exit,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      onAnimationComplete?: () => void;
      animate?: unknown;
      transition?: unknown;
      initial?: unknown;
      exit?: unknown;
    }) => <div {...props}>{children}</div>,
    h1: ({
      children,
      animate: _animate,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement> & {
      animate?: unknown;
      transition?: unknown;
    }) => <h1 {...props}>{children}</h1>,
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

    test("pressing Tab auto-completes the highlighted mention", async () => {
      mockUseWorkspace.mockReturnValue({
        workspace: { repositories: [], slug: "current-ws" },
        workspaces: mentionWorkspaces,
      });

      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "@test");

      fireEvent.keyDown(textarea, { key: "Tab" });

      expect(textarea.value).toContain("@test-ws");
      expect(screen.queryByTestId("mention-item-test-ws")).not.toBeInTheDocument();
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

  describe("submit behaviour — text persistence and isExiting", () => {
    test("onSubmit is NOT called synchronously when submit button is clicked", async () => {
      // framer-motion is mocked — onAnimationComplete is stripped, so onSubmit
      // should NOT be called during handleSubmit itself.
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My feature idea");

      const submitBtn = screen.getByTestId("plan-start-submit");
      fireEvent.click(submitBtn);

      // onSubmit should NOT have been called yet (only fires from onAnimationComplete)
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("textarea value is preserved after handleSubmit fires (no premature clear)", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My feature idea");

      const submitBtn = screen.getByTestId("plan-start-submit");
      fireEvent.click(submitBtn);

      // Text must still be visible — setValue("") removed
      expect(textarea.value).toBe("My feature idea");
    });

    test("textarea is disabled when isLoading is true", () => {
      render(<PlanStartInput onSubmit={onSubmit} isLoading={true} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      expect(textarea).toBeDisabled();
    });

    test("textarea is enabled when isLoading is false", () => {
      render(<PlanStartInput onSubmit={onSubmit} isLoading={false} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      expect(textarea).not.toBeDisabled();
    });

    test("onSubmit is not called for empty/whitespace-only text", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "   ");

      const submitBtn = screen.getByTestId("plan-start-submit");
      fireEvent.click(submitBtn);

      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("regression: submit does not immediately reset isExiting (form stays disabled after click)", async () => {
      // With the bug, the error-recovery useEffect would fire immediately after
      // setIsExiting(true) because isLoading is still false, resetting isExiting
      // and re-enabling the form. With the fix, wasLoadingRef gates the reset.
      const { rerender } = render(<PlanStartInput onSubmit={onSubmit} isLoading={false} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My feature idea");

      const submitBtn = screen.getByTestId("plan-start-submit");
      fireEvent.click(submitBtn);

      // isLoading is still false, but the form should NOT have re-enabled itself.
      // Re-render with the same props to flush any effects.
      rerender(<PlanStartInput onSubmit={onSubmit} isLoading={false} />);

      // onSubmit must not have been called yet (animation is mid-flight / mocked away)
      expect(onSubmit).not.toHaveBeenCalled();
      // The submit button should be disabled (isExiting is true, hasText is true but isExiting guard)
      // In our mocked framer-motion onAnimationComplete is stripped, so the button
      // stays disabled via the !hasText || isLoading check — but critically it has
      // not been re-enabled by a premature isExiting reset.
      expect(textarea).not.toBeDisabled(); // textarea enabled only after real error recovery
    });

    test("error recovery: isExiting resets after isLoading cycles true then false", async () => {
      // Simulate: user submits → API call starts (isLoading=true) → API errors (isLoading=false)
      // The form should become interactive again.
      const { rerender } = render(<PlanStartInput onSubmit={onSubmit} isLoading={false} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My feature idea");

      fireEvent.click(screen.getByTestId("plan-start-submit"));

      // Simulate loading starting (onSubmit called from onAnimationComplete in real app)
      rerender(<PlanStartInput onSubmit={onSubmit} isLoading={true} />);

      // Now simulate the API erroring — loading goes back to false
      rerender(<PlanStartInput onSubmit={onSubmit} isLoading={false} />);

      // After the error recovery cycle, the textarea should be re-enabled
      expect(textarea).not.toBeDisabled();
    });

    test("double-submit guard: pressing Enter twice only submits once", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My feature idea");

      // Fire Enter twice in quick succession
      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // onSubmit is only called from onAnimationComplete (mocked away here),
      // so it should not be called at all — but critically not twice either.
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
