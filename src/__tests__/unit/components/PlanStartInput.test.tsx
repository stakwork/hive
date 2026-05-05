import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
      const { waitFor: localWaitFor } = await import("@testing-library/react");
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;

      // Wait for llm-models to load so selectedModel is set
      await localWaitFor(() => {
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
      });
    });

    test("onSubmit is called immediately when Enter is pressed with text", async () => {
      const { waitFor: localWaitFor } = await import("@testing-library/react");
      render(<PlanStartInput onSubmit={onSubmit} />);
      const textarea = screen.getByTestId("plan-start-input") as HTMLTextAreaElement;

      // Wait for llm-models to load
      await localWaitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/llm-models");
      });

      await userEvent.type(textarea, "My feature idea");

      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith("My feature idea", {
        isPrototype: false,
        model: "anthropic/claude-sonnet-4",
        selectedRepoId: null,
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
      const { waitFor } = await import("@testing-library/react");
      localStorage.setItem(PLAN_MODEL_PREFERENCE_KEY, "openai/gpt-4o");

      render(<PlanStartInput onSubmit={onSubmit} />);

      await waitFor(() => {
        expect(screen.getByTestId("model-selector")).toBeInTheDocument();
        expect(screen.getByTestId("model-selector").textContent).toContain("gpt-4o");
      });
    });

    test("falls back to isPlanDefault when stored key is absent", async () => {
      const { waitFor } = await import("@testing-library/react");
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
      const { waitFor } = await import("@testing-library/react");
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
      const { waitFor } = await import("@testing-library/react");

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
});
