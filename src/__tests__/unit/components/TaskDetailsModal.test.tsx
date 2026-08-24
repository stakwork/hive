/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) => (
    <button onClick={onClick} disabled={disabled} className={className}>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: ({ className }: { className?: string }) => <hr className={className} />,
}));

// Capture the className passed to DialogContent for assertion
let capturedDialogContentClassName = "";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className, style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
    capturedDialogContentClassName = className ?? "";
    return (
      <div data-testid="dialog-content" className={className} style={style}>
        {children}
      </div>
    );
  },
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <div data-testid="dialog-footer">{children}</div>,
}));

// Functional Select mock — SelectItem renders a button wired to onValueChange
vi.mock("@/components/ui/select", () => {
  const Ctx = React.createContext<((v: string) => void) | undefined>(undefined);
  return {
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children?: React.ReactNode;
      value?: string;
      onValueChange?: (v: string) => void;
    }) => (
      <Ctx.Provider value={onValueChange}>
        <div data-testid="select-root" data-value={value}>
          {children}
        </div>
      </Ctx.Provider>
    ),
    SelectTrigger: ({
      children,
      "data-testid": testId,
    }: {
      children?: React.ReactNode;
      "data-testid"?: string;
    }) => <div data-testid={testId ?? "select-trigger"}>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children?: React.ReactNode; value?: string }) => {
      const onValueChange = React.useContext(Ctx);
      return (
        <button
          data-testid="select-item"
          data-value={value}
          onClick={() => value !== undefined && onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("lucide-react", () => ({
  FileIcon: () => <svg data-testid="file-icon" />,
  Loader2: () => <svg data-testid="loader-icon" />,
  AlertCircle: () => <svg data-testid="alert-icon" />,
  ExternalLink: () => <svg data-testid="external-link-icon" />,
  // Check is needed by Checkbox component
  Check: () => <svg data-testid="check-icon" />,
}));

vi.mock("@/lib/harvey-lab-tasks", () => ({
  WORK_TYPE_STYLES: {
    "antitrust": { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  },
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import { TaskDetailsModal } from "@/components/legal/TaskDetailsModal";
import type { HarveyTask } from "@/lib/harvey-lab-tasks";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockTask: HarveyTask = {
  slug: "antitrust/review-merger",
  title: "Review Merger Filing",
  description: "Analyze antitrust implications of the proposed merger.",
  workType: "antitrust",
  taskType: "review",
  difficulty: "hard",
  tags: ["antitrust", "merger"],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TaskDetailsModal", () => {
  beforeEach(() => {
    capturedDialogContentClassName = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error" }));
  });

  it("renders DialogContent with overflow-hidden class", () => {
    render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(capturedDialogContentClassName).toContain("overflow-hidden");
  });

  it("renders DialogContent with max-h-[80vh] and flex flex-col alongside overflow-hidden", () => {
    render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(capturedDialogContentClassName).toContain("h-[80vh]");
    expect(capturedDialogContentClassName).toContain("flex");
    expect(capturedDialogContentClassName).toContain("flex-col");
    expect(capturedDialogContentClassName).toContain("overflow-hidden");
  });

  it("renders the footer when modal is open", () => {
    const { getByTestId } = render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(getByTestId("dialog-footer")).toBeTruthy();
  });

  it("does not render when open is false", () => {
    const { queryByTestId } = render(
      <TaskDetailsModal
        open={false}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    expect(queryByTestId("dialog-content")).toBeNull();
  });
});

// ─── DOCX editor link tests ───────────────────────────────────────────────────

describe("TaskDetailsModal — DOCX editor link", () => {
  const docxDocument = {
    name: "contract.docx",
    url: "https://github.com/stakwork/harvey-labs/blob/main/tasks/corporate/contract.docx",
    download_url:
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/contract.docx",
  };

  const pdfDocument = {
    name: "merger_agreement.pdf",
    url: "https://github.com/stakwork/harvey-labs/blob/main/tasks/corporate/merger.pdf",
    download_url:
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/merger.pdf",
  };

  const taskWithDocs: HarveyTask = {
    slug: "corporate/review-contract",
    title: "Review Contract",
    description: "Review the contract.",
    workType: "antitrust",
    taskType: "review",
    difficulty: "medium",
    tags: [],
  };

  beforeEach(() => {
    // Return a details payload with both docx and non-docx docs
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          title: taskWithDocs.title,
          instructions: "Review the contract carefully.",
          criteria: [],
          documents: [docxDocument, pdfDocument],
        }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an open-in-editor-link for .docx documents", async () => {
    const { findByTestId } = render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={taskWithDocs}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    const editorLink = await findByTestId("open-in-editor-link");
    expect(editorLink).toBeTruthy();
  });

  it("editor link href routes through /documents?url= with encoded download_url", async () => {
    const { findByTestId } = render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={taskWithDocs}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    const editorLink = await findByTestId("open-in-editor-link");
    const href = editorLink.getAttribute("href") ?? "";
    expect(href).toContain("/w/openlaw/documents?url=");
    expect(href).toContain(encodeURIComponent(docxDocument.download_url));
    expect(href).toContain(encodeURIComponent("contract.docx"));
  });

  it("does NOT render open-in-editor-link for non-.docx files", async () => {
    const { findAllByTestId, queryByTestId } = render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={taskWithDocs}
        slug="openlaw"
        onRunTask={vi.fn()}
      />,
    );

    // Wait for the docx link to appear (documents loaded)
    await findAllByTestId("open-in-editor-link");

    // There should be exactly one open-in-editor-link (for .docx only, not .pdf)
    const allEditorLinks = document.querySelectorAll(
      '[data-testid="open-in-editor-link"]',
    );
    expect(allEditorLinks).toHaveLength(1);
  });
});
// ─── Model pair selection ─────────────────────────────────────────────────────

describe("TaskDetailsModal — model pair selection", () => {
  const MOCK_MODELS = [
    { id: "m1", name: "claude-sonnet-5", provider: "ANTHROPIC", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
    { id: "m2", name: "claude-opus-4-6", provider: "ANTHROPIC", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
    { id: "m3", name: "gpt-5.2", provider: "OPENAI", providerLabel: null, isPlanDefault: false, isTaskDefault: false },
    { id: "m4", name: "custom-x", provider: "OTHER", providerLabel: "Acme", isPlanDefault: false, isTaskDefault: false },
  ];

  function stubFetch({ models = MOCK_MODELS, modelsOk = true }: { models?: unknown[]; modelsOk?: boolean } = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url) === "/api/llm-models") {
          return Promise.resolve({ ok: modelsOk, json: async () => ({ models }) });
        }
        // task details + size endpoints: not under test here
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }),
    );
  }

  function renderModal(onRunTask = vi.fn()) {
    render(
      <TaskDetailsModal
        open={true}
        onOpenChange={vi.fn()}
        task={mockTask}
        slug="openlaw"
        onRunTask={onRunTask}
      />,
    );
    return onRunTask;
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders provider, standard and reasoning selects once the catalog loads", async () => {
    stubFetch();
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("provider-select")).toBeInTheDocument();
    });
    expect(screen.getByTestId("standard-model-select")).toBeInTheDocument();
    expect(screen.getByTestId("reasoning-model-select")).toBeInTheDocument();
  });

  it("defaults to the Anthropic provider with the default standard/reasoning pair", async () => {
    stubFetch();
    renderModal();

    await waitFor(() => {
      const roots = screen.getAllByTestId("select-root");
      expect(roots[0]).toHaveAttribute("data-value", "ANTHROPIC");
      expect(roots[1]).toHaveAttribute("data-value", "anthropic/claude-sonnet-5");
      expect(roots[2]).toHaveAttribute("data-value", "anthropic/claude-opus-4-6");
    });
  });

  it("excludes providers without an API key env mapping (OTHER) from the provider dropdown", async () => {
    stubFetch();
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("provider-select")).toBeInTheDocument();
    });

    const providerRoot = screen.getAllByTestId("select-root")[0];
    const providerValues = within(providerRoot)
      .getAllByTestId("select-item")
      .map((el) => el.getAttribute("data-value"));
    expect(providerValues).toEqual(["ANTHROPIC", "OPENAI"]);
  });

  it("filters model options to the selected provider and resets the pair on provider change", async () => {
    stubFetch();
    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("provider-select")).toBeInTheDocument();
    });

    // Switch provider to OPENAI
    const providerRoot = screen.getAllByTestId("select-root")[0];
    fireEvent.click(within(providerRoot).getAllByTestId("select-item")[1]);

    await waitFor(() => {
      const roots = screen.getAllByTestId("select-root");
      expect(roots[0]).toHaveAttribute("data-value", "OPENAI");
      // Both models reset to the provider's first model
      expect(roots[1]).toHaveAttribute("data-value", "openai/gpt-5.2");
      expect(roots[2]).toHaveAttribute("data-value", "openai/gpt-5.2");
    });

    // Model dropdowns only list OPENAI models
    const standardRoot = screen.getAllByTestId("select-root")[1];
    const values = within(standardRoot)
      .getAllByTestId("select-item")
      .map((el) => el.getAttribute("data-value"));
    expect(values).toEqual(["openai/gpt-5.2"]);
  });

  it("passes the selected pair to onRunTask", async () => {
    stubFetch();
    const onRunTask = renderModal();

    await waitFor(() => {
      expect(screen.getByTestId("provider-select")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Run Task"));

    expect(onRunTask).toHaveBeenCalledWith({
      generateJamieChat: false,
      generateRunReport: false,
      standardModel: "anthropic/claude-sonnet-5",
      reasoningModel: "anthropic/claude-opus-4-6",
    });
  });

  it("omits the pair from onRunTask when the catalog fetch fails", async () => {
    stubFetch({ modelsOk: false });
    const onRunTask = renderModal();

    // Selectors never appear
    await waitFor(() => {
      expect(screen.queryByTestId("provider-select")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Run Task"));

    expect(onRunTask).toHaveBeenCalledWith({
      generateJamieChat: false,
      generateRunReport: false,
    });
  });
});
