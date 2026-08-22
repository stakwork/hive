// @vitest-environment jsdom
/**
 * Unit tests for DocxFindReplace.
 *
 * Covers:
 *  - Renders Find input and Close button
 *  - Shows Replace row after toggling expand button
 *  - "N of M" counter shows correct match count
 *  - Replace All across two documents fires Sonner toast per affected doc
 *  - Replace All with no matches fires "No matches found" toast
 *  - Case-insensitive search by default; case-sensitive finds fewer results
 *  - Scope "This doc" vs "All docs" filters correctly
 *  - Escape key closes the component
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mock sonner toast ─────────────────────────────────────────────────────────
// vi.mock is hoisted before all imports, so the factory MUST NOT reference
// any module-level variable.  We use vi.hoisted() to declare the mock fns
// in the same hoisted scope as vi.mock().
const { mockToastSuccess, mockToastInfo, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: mockToastSuccess,
    info: mockToastInfo,
    error: mockToastError,
  }),
}));

// ── Mock UI components ────────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className, title, ...rest }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={title}
      data-testid={rest["data-testid"]}
      {...rest}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef(({ value, onChange, placeholder, className, onKeyDown, ...rest }: any, ref: any) => (
    <input
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      onKeyDown={onKeyDown}
      {...rest}
    />
  )),
}));

vi.mock("lucide-react", () => ({
  ChevronUp: () => <span data-testid="icon-prev">▲</span>,
  ChevronDown: () => <span data-testid="icon-next">▼</span>,
  X: () => <span data-testid="icon-x">×</span>,
  ChevronsUpDown: () => <span data-testid="icon-toggle">⇕</span>,
  Replace: () => <span data-testid="icon-replace">⟳</span>,
}));

// ── Import component (after mocks) ───────────────────────────────────────────
import DocxFindReplace from "@/components/docx-editor/DocxFindReplace";
import { EditorState, createEditorState } from "@/lib/docx-editor/editor-state";
import {
  DocxDocument,
  DocxParagraph,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoc(id: string, filename: string, paragraphs: string[]): DocxDocument {
  const blocks: DocxParagraph[] = paragraphs.map((text, i) => ({
    kind: "paragraph",
    id: `${id}-p${i}`,
    properties: {},
    runs: [
      {
        kind: "text",
        id: `${id}-r${i}`,
        text,
        properties: {},
      } as DocxTextRun,
    ],
  }));
  return {
    id,
    filename,
    blocks,
    comments: [],
    styles: new Map(),
    numbering: { abstractDefs: new Map(), numDefs: new Map() },
    sectionProperties: {},
    imageUrls: new Map(),
  };
}

function makeState(doc: DocxDocument): EditorState {
  return createEditorState(doc);
}

function renderFindReplace(options: {
  allStates?: EditorState[];
  activeIndex?: number;
  onReplace?: (s: EditorState[]) => void;
  onClose?: () => void;
}) {
  const onReplace = options.onReplace ?? vi.fn();
  const onClose = options.onClose ?? vi.fn();
  const allStates = options.allStates ?? [
    makeState(makeDoc("d1", "doc1.docx", ["The quick brown fox", "jumps over the lazy dog"])),
  ];
  const activeIndex = options.activeIndex ?? 0;

  const result = render(
    <DocxFindReplace
      allStates={allStates}
      activeIndex={activeIndex}
      onReplace={onReplace}
      onClose={onClose}
    />
  );

  return { ...result, onReplace, onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DocxFindReplace — basic rendering", () => {
  it("renders the Find input", () => {
    renderFindReplace({});
    expect(screen.getByPlaceholderText("Find…")).toBeInTheDocument();
  });

  it("renders a close button", () => {
    renderFindReplace({});
    // Close button has title "Close (Esc)"
    expect(screen.getByTitle("Close (Esc)")).toBeInTheDocument();
  });

  it("does NOT show Replace input initially (replace row is collapsed)", () => {
    renderFindReplace({});
    expect(screen.queryByPlaceholderText("Replace with…")).toBeNull();
  });

  it("shows Replace input after clicking the expand toggle", async () => {
    renderFindReplace({});
    const toggleBtn = screen.getByTitle(/collapse replace|expand replace/i);
    await userEvent.click(toggleBtn);
    expect(screen.getByPlaceholderText("Replace with…")).toBeInTheDocument();
  });
});

describe("DocxFindReplace — match counter", () => {
  it("shows 'No results' when query has no matches", async () => {
    renderFindReplace({
      allStates: [
        makeState(makeDoc("d1", "test.docx", ["Hello world"])),
      ],
    });
    const findInput = screen.getByPlaceholderText("Find…");
    await userEvent.type(findInput, "zzzzz");
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it("shows '1 / 1' when there is exactly one match", async () => {
    renderFindReplace({
      allStates: [
        makeState(makeDoc("d1", "test.docx", ["Hello world"])),
      ],
    });
    const findInput = screen.getByPlaceholderText("Find…");
    await userEvent.type(findInput, "Hello");
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("shows correct count for multiple matches (case-insensitive by default)", async () => {
    renderFindReplace({
      allStates: [
        makeState(makeDoc("d1", "test.docx", [
          "hello world",
          "Hello again",
          "HELLO upper",
        ])),
      ],
    });
    const findInput = screen.getByPlaceholderText("Find…");
    await userEvent.type(findInput, "hello");
    // Case-insensitive: 3 matches across 3 paragraphs
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });
});

describe("DocxFindReplace — case sensitivity toggle", () => {
  it("finds fewer matches with case-sensitive enabled", async () => {
    renderFindReplace({
      allStates: [
        makeState(makeDoc("d1", "test.docx", [
          "hello world",
          "Hello again",
          "HELLO upper",
        ])),
      ],
    });
    const findInput = screen.getByPlaceholderText("Find…");
    await userEvent.type(findInput, "hello");

    // Default: case-insensitive → 3 matches
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    // Toggle case-sensitive
    const caseBtn = screen.getByTitle("Case sensitive");
    await userEvent.click(caseBtn);

    // Now only "hello world" matches (exact lowercase)
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });
});

describe("DocxFindReplace — scope toggle", () => {
  const twoDocStates = [
    makeState(makeDoc("d1", "doc1.docx", ["The word is here"])),
    makeState(makeDoc("d2", "doc2.docx", ["The word is also here"])),
  ];

  it("scope 'This doc' counts only active doc matches", async () => {
    renderFindReplace({ allStates: twoDocStates, activeIndex: 0 });
    const findInput = screen.getByPlaceholderText("Find…");
    await userEvent.type(findInput, "word");

    // Active doc (d1) has 1 match
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("scope 'All docs' counts matches across all documents", async () => {
    renderFindReplace({ allStates: twoDocStates, activeIndex: 0 });
    const findInput = screen.getByPlaceholderText("Find…");
    await userEvent.type(findInput, "word");

    // Switch to "All docs"
    const allDocsBtn = screen.getByText("All docs");
    await userEvent.click(allDocsBtn);

    // d1 has 1, d2 has 1 → total 2
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });
});

describe("DocxFindReplace — Replace All with Sonner toasts", () => {
  beforeEach(() => {
    mockToastSuccess.mockReset();
    mockToastInfo.mockReset();
    mockToastError.mockReset();
  });

  it("fires toast.info('No matches found') when there are no matches", async () => {
    const onReplace = vi.fn();
    renderFindReplace({
      allStates: [makeState(makeDoc("d1", "doc1.docx", ["Hello world"]))],
      onReplace,
    });

    // Expand replace row
    await userEvent.click(screen.getByTitle(/expand replace/i));

    const findInput = screen.getByPlaceholderText("Find…");
    const replaceInput = screen.getByPlaceholderText("Replace with…");

    await userEvent.type(findInput, "ZZZZZ");
    await userEvent.type(replaceInput, "nothing");

    const replaceAllBtn = screen.getByText("Replace All");
    await userEvent.click(replaceAllBtn);

    expect(mockToastInfo).toHaveBeenCalledWith("No matches found");
    expect(onReplace).toHaveBeenCalled(); // still called
  });

  it("fires a toast.success per affected document after Replace All", async () => {
    const twoDocStates = [
      makeState(makeDoc("d1", "contract.docx", ["Party A shall", "Party A agrees"])),
      makeState(makeDoc("d2", "redline.docx", ["Party A shall also"])),
    ];
    const onReplace = vi.fn();

    renderFindReplace({
      allStates: twoDocStates,
      activeIndex: 0,
      onReplace,
    });

    // Expand replace row
    await userEvent.click(screen.getByTitle(/expand replace/i));

    const findInput = screen.getByPlaceholderText("Find…");
    const replaceInput = screen.getByPlaceholderText("Replace with…");

    await userEvent.type(findInput, "Party A");
    await userEvent.type(replaceInput, "Party B");

    // Switch to "All docs" so both docs are in scope
    await userEvent.click(screen.getByText("All docs"));

    const replaceAllBtn = screen.getByText("Replace All");
    await userEvent.click(replaceAllBtn);

    // toast.success should fire for each doc with matches
    // doc1 has 2 matches, doc2 has 1 match
    expect(mockToastSuccess).toHaveBeenCalledTimes(2);

    // Check that filenames appear in the toasts
    const calls = mockToastSuccess.mock.calls.map((c: any[]) => c[0]);
    const hasContract = calls.some((msg: string) => msg.includes("contract.docx"));
    const hasRedline = calls.some((msg: string) => msg.includes("redline.docx"));
    expect(hasContract).toBe(true);
    expect(hasRedline).toBe(true);
  });

  it("includes replacement count in the toast message", async () => {
    const onReplace = vi.fn();
    renderFindReplace({
      allStates: [
        makeState(makeDoc("d1", "sample.docx", [
          "foo bar foo",
          "another foo here",
        ])),
      ],
      onReplace,
    });

    await userEvent.click(screen.getByTitle(/expand replace/i));
    await userEvent.type(screen.getByPlaceholderText("Find…"), "foo");
    await userEvent.type(screen.getByPlaceholderText("Replace with…"), "baz");

    await userEvent.click(screen.getByText("Replace All"));

    // "foo" appears 3 times across 2 paragraphs in 1 doc
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    const msg: string = mockToastSuccess.mock.calls[0][0];
    expect(msg).toContain("sample.docx");
    expect(msg).toMatch(/3 occurrence/);
  });
});

describe("DocxFindReplace — keyboard shortcuts", () => {
  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    renderFindReplace({ onClose });

    // Escape fires the window keydown handler
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(onClose).toHaveBeenCalled();
  });
});
