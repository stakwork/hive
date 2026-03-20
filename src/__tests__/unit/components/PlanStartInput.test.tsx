import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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
import { toast } from "sonner";

const mentionWorkspaces = [
  { slug: "test-ws", name: "Test WS" },
  { slug: "other-ws", name: "Other WS" },
];

const makeImageFile = (name = "photo.png", type = "image/png", size = 1024) => {
  const file = new File(["x".repeat(size)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

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
    // Mock URL APIs
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
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

  describe("image attachment", () => {
    test("dropping a valid image file stages a thumbnail in the UI", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const card = screen.getByTestId("plan-start-input").closest(".rounded-3xl")!;

      const file = makeImageFile("test.png", "image/png");
      const dataTransfer = { files: [file] };

      fireEvent.dragEnter(card, { dataTransfer });
      fireEvent.dragOver(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });

      await waitFor(() => {
        expect(screen.getByTestId("pending-images-grid")).toBeInTheDocument();
      });
      expect(screen.getAllByRole("img").length).toBeGreaterThan(0);
    });

    test("pasting an image stages a thumbnail", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input");

      const file = makeImageFile("pasted.png", "image/png");
      const clipboardData = {
        items: [
          {
            type: "image/png",
            getAsFile: () => file,
          },
        ],
        getData: () => "",
      };

      fireEvent.paste(textarea, { clipboardData });

      await waitFor(() => {
        expect(screen.getByTestId("pending-images-grid")).toBeInTheDocument();
      });
    });

    test("clicking the remove button on a thumbnail removes it from the grid", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const card = screen.getByTestId("plan-start-input").closest(".rounded-3xl")!;

      const file = makeImageFile("remove-me.png", "image/png");
      const dataTransfer = { files: [file] };

      fireEvent.dragEnter(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });

      await waitFor(() => {
        expect(screen.getByTestId("pending-images-grid")).toBeInTheDocument();
      });

      // Find and click the remove button
      const removeButtons = screen.getAllByLabelText(/Remove/);
      expect(removeButtons.length).toBe(1);
      fireEvent.click(removeButtons[0]);

      await waitFor(() => {
        expect(screen.queryByTestId("pending-images-grid")).not.toBeInTheDocument();
      });
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

    test("submitting with staged images does not call onSubmit synchronously (deferred to animation)", async () => {
      // onSubmit fires from onAnimationComplete (framer-motion mocked — won't fire in tests)
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input");
      const card = textarea.closest(".rounded-3xl")!;

      const file = makeImageFile("attach.png", "image/png", 2048);
      const dataTransfer = { files: [file] };

      fireEvent.dragEnter(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });

      await waitFor(() => {
        expect(screen.getByTestId("pending-images-grid")).toBeInTheDocument();
      });

      // Type some text so submit is enabled
      await userEvent.type(textarea, "Build a feature");

      fireEvent.click(screen.getByTestId("plan-start-submit"));

      // onSubmit is deferred to onAnimationComplete; not called synchronously
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("dropping a non-image file shows a toast error and does not stage it", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const card = screen.getByTestId("plan-start-input").closest(".rounded-3xl")!;

      const file = new File(["content"], "document.pdf", { type: "application/pdf" });
      const dataTransfer = { files: [file] };

      fireEvent.dragEnter(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("pending-images-grid")).not.toBeInTheDocument();
    });

    test("dropping a file larger than 10MB shows a toast error and does not stage it", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const card = screen.getByTestId("plan-start-input").closest(".rounded-3xl")!;

      const oversizedFile = makeImageFile("huge.png", "image/png", 11 * 1024 * 1024);
      const dataTransfer = { files: [oversizedFile] };

      fireEvent.dragEnter(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("pending-images-grid")).not.toBeInTheDocument();
    });

    test("submit button remains disabled when only images are staged (no text)", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const card = screen.getByTestId("plan-start-input").closest(".rounded-3xl")!;

      const file = makeImageFile("img.png", "image/png");
      const dataTransfer = { files: [file] };

      fireEvent.dragEnter(card, { dataTransfer });
      fireEvent.drop(card, { dataTransfer });

      await waitFor(() => {
        expect(screen.getByTestId("pending-images-grid")).toBeInTheDocument();
      });

      const submitBtn = screen.getByTestId("plan-start-submit");
      expect(submitBtn).toBeDisabled();
    });

    test("image upload button triggers file input click", () => {
      render(<PlanStartInput onSubmit={onSubmit} />);

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, "click");

      fireEvent.click(screen.getByTestId("image-upload-button"));

      expect(clickSpy).toHaveBeenCalled();
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
  });
});
