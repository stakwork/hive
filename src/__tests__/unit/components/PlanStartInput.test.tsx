import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { repositories: [] },
  }),
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

import { PlanStartInput } from "@/app/w/[slug]/plan/new/components/PlanStartInput";

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
