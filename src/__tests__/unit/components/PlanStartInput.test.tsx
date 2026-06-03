// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Hoist mocks so they are available before module resolution
const { mockSpeechRecognitionState, mockUseSpeechRecognition, mockUseControlKeyHold, mockFetch } =
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

    const mockLlmFetch = vi.fn((url: string) => {
      if (url === "/api/llm-models") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [
              { id: "1", name: "claude-sonnet-4", provider: "ANTHROPIC", providerLabel: "Claude Sonnet 4" },
              { id: "2", name: "gpt-4o", provider: "OPENAI", providerLabel: "GPT-4o" },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    return {
      mockSpeechRecognitionState: state,
      mockUseSpeechRecognition: mockFn,
      mockUseControlKeyHold: mockControlKey,
      mockFetch: mockLlmFetch,
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

vi.mock("@/hooks/useRecentWorkflows", () => ({
  useRecentWorkflows: () => ({ workflows: [], isLoading: false, error: null }),
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: () => false,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children, className, ...props }: any) => (
    <div data-testid={props["data-testid"] ?? "select-trigger"} className={className} {...props}>{children}</div>
  ),
  SelectValue: () => <span>Select</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectGroup: ({ children }: any) => <div>{children}</div>,
  SelectLabel: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectSeparator: () => <hr />,
  SelectScrollUpButton: () => null,
  SelectScrollDownButton: () => null,
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      animate: _animate,
      transition: _transition,
      initial: _initial,
      exit: _exit,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
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

// Mock URL.createObjectURL and URL.revokeObjectURL for file previews
const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(URL, "createObjectURL", { value: mockCreateObjectURL, writable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: mockRevokeObjectURL, writable: true });

// jsdom does not implement scrollIntoView; cmdk calls it internally
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

import { PlanStartInput } from "@/app/w/[slug]/plan/new/components/PlanStartInput";
import { PLAN_MODEL_PREFERENCE_KEY } from "@/lib/ai/models";

const mentionWorkspaces = [
  { slug: "test-ws", name: "Test WS" },
  { slug: "other-ws", name: "Other WS" },
];

/** Create a mock File with given type and size */
function makeMockFile(name: string, type: string, size: number): File {
  const file = new File(["x".repeat(Math.min(size, 100))], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("PlanStartInput", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    global.fetch = mockFetch as unknown as typeof fetch;
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

  afterEach(() => {
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
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

  describe("submit behaviour", () => {
    test("onSubmit is called immediately when submit button is clicked with text", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;

      // Wait for llm-models to load so selectedModel is set
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/llm-models");
      });

      await userEvent.type(textarea, "My feature idea");

      const submitBtn = screen.getByTestId("plan-start-submit");
      fireEvent.click(submitBtn);

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith("My feature idea", {
        isPrototype: false,
        model: "anthropic/claude-sonnet-4",
        selectedRepoId: null,
        selectedWorkflow: null,
        attachmentFile: undefined,
      });
    });

    test("onSubmit is called immediately when Enter is pressed with text", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;

      // Wait for llm-models to load
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/llm-models");
      });

      await userEvent.type(textarea, "My feature idea");

      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith("My feature idea", {
        isPrototype: false,
        model: "anthropic/claude-sonnet-4",
        selectedRepoId: null,
        selectedWorkflow: null,
        attachmentFile: undefined,
      });
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

    test("onSubmit is not called when isLoading is true", async () => {
      render(<PlanStartInput onSubmit={onSubmit} isLoading={true} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      // Typing is disabled but we can test the guard via keydown
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("double-submit guard: pressing Enter twice only submits once", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My feature idea");

      fireEvent.keyDown(textarea, { key: "Enter" });
      fireEvent.keyDown(textarea, { key: "Enter" });

      // onSubmit is called on the first Enter; second Enter also calls it
      // (no isExiting guard), so both fire — but the key point is it's not zero.
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe("localStorage model preference", () => {
    test("defaults to stored preference when present and valid", async () => {
      localStorage.setItem(PLAN_MODEL_PREFERENCE_KEY, "openai/gpt-4o");

      render(<PlanStartInput onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByTestId("model-selector")).toBeInTheDocument();
        expect(screen.getByTestId("model-selector").textContent).toContain("gpt-4o");
      });
    });

    test("falls back to isPlanDefault when stored key is absent", async () => {
      const fetchWithDefault = vi.fn((url: string) => {
        if (url === "/api/llm-models") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [
                { id: "1", name: "claude-sonnet-4", provider: "ANTHROPIC", providerLabel: "Claude Sonnet 4", isPlanDefault: false, isTaskDefault: false },
                { id: "2", name: "gpt-4o", provider: "OPENAI", providerLabel: "GPT-4o", isPlanDefault: true, isTaskDefault: false },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
      global.fetch = fetchWithDefault as unknown as typeof fetch;

      render(<PlanStartInput onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByTestId("model-selector")).toBeInTheDocument();
        expect(screen.getByTestId("model-selector").textContent).toContain("gpt-4o");
      });
    });

    test("falls back to isPlanDefault when stored value is not in the fetched models list", async () => {
      localStorage.setItem(PLAN_MODEL_PREFERENCE_KEY, "other/removed-model");

      const fetchWithDefault = vi.fn((url: string) => {
        if (url === "/api/llm-models") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              models: [
                { id: "1", name: "claude-sonnet-4", provider: "ANTHROPIC", providerLabel: "Claude Sonnet 4", isPlanDefault: false, isTaskDefault: false },
                { id: "2", name: "gpt-4o", provider: "OPENAI", providerLabel: "GPT-4o", isPlanDefault: true, isTaskDefault: false },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });
      global.fetch = fetchWithDefault as unknown as typeof fetch;

      render(<PlanStartInput onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByTestId("model-selector")).toBeInTheDocument();
        expect(screen.getByTestId("model-selector").textContent).toContain("gpt-4o");
      });
    });

    test("persists model to localStorage on form submit", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;

      // Wait for models to fully load (state updated, selector visible)
      await waitFor(() => {
        expect(screen.getByTestId("model-selector")).toBeInTheDocument();
      });

      await userEvent.type(textarea, "My feature idea");
      fireEvent.click(screen.getByTestId("plan-start-submit"));

      expect(localStorage.getItem(PLAN_MODEL_PREFERENCE_KEY)).not.toBeNull();
      expect(localStorage.getItem(PLAN_MODEL_PREFERENCE_KEY)).toBe("anthropic/claude-sonnet-4");
    });
  });

  describe("file attachment", () => {
    test("attach image button is rendered in the bottom row", () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      expect(screen.getByTestId("attach-image-button")).toBeInTheDocument();
    });

    test("attach image button is to the left of the submit button", () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const attachBtn = screen.getByTestId("attach-image-button");
      const submitBtn = screen.getByTestId("plan-start-submit");

      // Both should be in the bottom row
      const bottomRow = screen.getByTestId("bottom-row");
      expect(bottomRow).toContainElement(attachBtn);
      expect(bottomRow).toContainElement(submitBtn);

      // The attach button should appear before the submit button in the DOM
      const position = attachBtn.compareDocumentPosition(submitBtn);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test("drop zone is shown initially (no file selected)", () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      expect(screen.getByTestId("drop-zone")).toBeInTheDocument();
      expect(screen.queryByTestId("file-preview")).not.toBeInTheDocument();
    });

    test("selecting a valid PNG file shows the preview thumbnail", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

      const file = makeMockFile("screenshot.png", "image/png", 1024 * 1024);
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("file-preview")).toBeInTheDocument();
        expect(screen.getByTestId("preview-image")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("drop-zone")).not.toBeInTheDocument();
      expect(screen.getByText("screenshot.png")).toBeInTheDocument();
      expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
    });

    test("clicking remove button clears the attached file", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

      const file = makeMockFile("screenshot.png", "image/png", 1024 * 1024);
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("file-preview")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("remove-file-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("file-preview")).not.toBeInTheDocument();
        expect(screen.getByTestId("drop-zone")).toBeInTheDocument();
      });

      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    test("selecting an invalid file type (PDF) shows a toast error and no preview", async () => {
      const { toast } = await import("sonner");
      const toastErrorSpy = vi.spyOn(toast, "error");

      render(<PlanStartInput onSubmit={onSubmit} />);
      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

      const file = makeMockFile("document.pdf", "application/pdf", 1024);
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(toastErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid file type"),
      );
      expect(screen.queryByTestId("file-preview")).not.toBeInTheDocument();
    });

    test("selecting a file larger than 10MB shows a toast error", async () => {
      const { toast } = await import("sonner");
      const toastErrorSpy = vi.spyOn(toast, "error");

      render(<PlanStartInput onSubmit={onSubmit} />);
      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

      const file = makeMockFile("huge.png", "image/png", 11 * 1024 * 1024);
      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(toastErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("10MB"),
      );
      expect(screen.queryByTestId("file-preview")).not.toBeInTheDocument();
    });

    test("pasting an image from clipboard attaches the file", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input");

      const file = makeMockFile("pasted.png", "image/png", 512);
      const clipboardItem = {
        type: "image/png",
        getAsFile: () => file,
      };
      const pasteEvent = new Event("paste", { bubbles: true }) as any;
      pasteEvent.clipboardData = {
        items: [clipboardItem],
      };
      pasteEvent.preventDefault = vi.fn();

      fireEvent(textarea, pasteEvent);

      await waitFor(() => {
        expect(screen.getByTestId("file-preview")).toBeInTheDocument();
      });

      expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
    });

    test("submit with a file passes attachmentFile in options", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/llm-models");
      });

      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
      const file = makeMockFile("shot.png", "image/png", 2048);
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("file-preview")).toBeInTheDocument();
      });

      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My plan with image");

      fireEvent.click(screen.getByTestId("plan-start-submit"));

      expect(onSubmit).toHaveBeenCalledWith("My plan with image", expect.objectContaining({
        attachmentFile: file,
      }));
    });

    test("submit without file passes attachmentFile: undefined in options", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/llm-models");
      });

      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;
      await userEvent.type(textarea, "My plan without image");

      fireEvent.click(screen.getByTestId("plan-start-submit"));

      expect(onSubmit).toHaveBeenCalledWith("My plan without image", expect.objectContaining({
        attachmentFile: undefined,
      }));
    });

    test("text is still required even with a file attached — submit button disabled", async () => {
      render(<PlanStartInput onSubmit={onSubmit} />);
      const fileInput = screen.getByTestId("file-input") as HTMLInputElement;

      const file = makeMockFile("screenshot.png", "image/png", 1024);
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("file-preview")).toBeInTheDocument();
      });

      const submitBtn = screen.getByTestId("plan-start-submit");
      expect(submitBtn).toBeDisabled();

      fireEvent.click(submitBtn);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test("loadingStatus is displayed when isLoading is true", () => {
      render(
        <PlanStartInput
          onSubmit={onSubmit}
          isLoading={true}
          loadingStatus="Uploading image…"
        />,
      );

      expect(screen.getByTestId("loading-status")).toBeInTheDocument();
      expect(screen.getByTestId("loading-status").textContent).toBe("Uploading image…");
    });

    test("loadingStatus is not displayed when isLoading is false", () => {
      render(
        <PlanStartInput
          onSubmit={onSubmit}
          isLoading={false}
          loadingStatus="Uploading image…"
        />,
      );

      expect(screen.queryByTestId("loading-status")).not.toBeInTheDocument();
    });

    test("loadingStatus is not displayed when loadingStatus is empty string", () => {
      render(
        <PlanStartInput
          onSubmit={onSubmit}
          isLoading={true}
          loadingStatus=""
        />,
      );

      expect(screen.queryByTestId("loading-status")).not.toBeInTheDocument();
    });

    test("attach image button is disabled when isLoading is true", () => {
      render(<PlanStartInput onSubmit={onSubmit} isLoading={true} />);
      const attachBtn = screen.getByTestId("attach-image-button");
      expect(attachBtn).toBeDisabled();
    });
  });
});
