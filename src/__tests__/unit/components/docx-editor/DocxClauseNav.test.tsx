// @vitest-environment jsdom
/**
 * Unit tests for DocxClauseNav.
 *
 * Covers:
 *  - Renders a button for each ClauseEntry detected in the document
 *  - Indentation increases with depth
 *  - Empty document shows "No clauses detected"
 *  - Clicking an entry calls scrollIntoView (mocked)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DocxClauseNav from "@/components/docx-editor/DocxClauseNav";
import { EditorState, createEditorState } from "@/lib/docx-editor/editor-state";
import {
  DocxDocument,
  DocxParagraph,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";

// ── Mock detectClauses so we control the output ───────────────────────────────
vi.mock("@/lib/docx-editor/clause-detector", () => ({
  detectClauses: vi.fn(),
}));

import { detectClauses } from "@/lib/docx-editor/clause-detector";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoc(texts: string[]): DocxDocument {
  const blocks: DocxParagraph[] = texts.map((text, i) => ({
    kind: "paragraph",
    id: `para-${i}`,
    properties: {},
    runs: [{ kind: "text", id: `run-${i}`, text, properties: {} }],
  }));
  return {
    id: "test-doc",
    filename: "test.docx",
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DocxClauseNav — empty document", () => {
  beforeEach(() => {
    vi.mocked(detectClauses).mockReturnValue([]);
  });

  it("shows 'No clauses detected' when there are no clause entries", () => {
    const state = makeState(makeDoc([]));
    render(<DocxClauseNav state={state} />);
    expect(screen.getByText(/no clauses detected/i)).toBeInTheDocument();
  });
});

describe("DocxClauseNav — clause entries rendering", () => {
  beforeEach(() => {
    vi.mocked(detectClauses).mockReturnValue([
      { paraId: "para-0", text: "Article 1 Definitions", depth: 0 },
      { paraId: "para-1", text: "1. General Provisions", depth: 1 },
      { paraId: "para-2", text: "1.1 Scope", depth: 2 },
      { paraId: "para-3", text: "(a) Sub-clause Alpha", depth: 3 },
      { paraId: "para-4", text: "(i) Roman numeral", depth: 4 },
    ]);
  });

  it("renders a button for each clause entry", () => {
    const state = makeState(makeDoc([
      "Article 1 Definitions",
      "1. General Provisions",
      "1.1 Scope",
      "(a) Sub-clause Alpha",
      "(i) Roman numeral",
    ]));
    render(<DocxClauseNav state={state} />);
    expect(screen.getByText("Article 1 Definitions")).toBeInTheDocument();
    expect(screen.getByText("1. General Provisions")).toBeInTheDocument();
    expect(screen.getByText("1.1 Scope")).toBeInTheDocument();
    expect(screen.getByText("(a) Sub-clause Alpha")).toBeInTheDocument();
    expect(screen.getByText("(i) Roman numeral")).toBeInTheDocument();
  });

  it("applies greater padding-left for deeper depths", () => {
    const state = makeState(makeDoc([
      "Article 1 Definitions",
      "1. General Provisions",
      "1.1 Scope",
      "(a) Sub-clause Alpha",
      "(i) Roman numeral",
    ]));
    const { container } = render(<DocxClauseNav state={state} />);

    // Find all clause buttons (they have data-depth)
    const buttons = container.querySelectorAll("button[data-depth]");
    expect(buttons.length).toBe(5);

    // Extract paddingLeft values — they should increase with depth
    const paddings = Array.from(buttons).map((btn) => {
      const style = window.getComputedStyle(btn as HTMLElement);
      // Also check inline style directly
      return parseFloat((btn as HTMLElement).style.paddingLeft) || 0;
    });

    // depth 0 → smallest indent, depth 4 → largest
    expect(paddings[0]).toBeLessThan(paddings[1]);
    expect(paddings[1]).toBeLessThan(paddings[2]);
    expect(paddings[2]).toBeLessThan(paddings[3]);
    expect(paddings[3]).toBeLessThan(paddings[4]);
  });

  it("data-depth attribute matches the ClauseEntry depth", () => {
    const state = makeState(makeDoc([
      "Article 1 Definitions",
      "1. General Provisions",
      "1.1 Scope",
      "(a) Sub-clause Alpha",
      "(i) Roman numeral",
    ]));
    const { container } = render(<DocxClauseNav state={state} />);
    const buttons = container.querySelectorAll("button[data-depth]");
    expect(buttons[0].getAttribute("data-depth")).toBe("0");
    expect(buttons[1].getAttribute("data-depth")).toBe("1");
    expect(buttons[2].getAttribute("data-depth")).toBe("2");
    expect(buttons[3].getAttribute("data-depth")).toBe("3");
    expect(buttons[4].getAttribute("data-depth")).toBe("4");
  });
});

describe("DocxClauseNav — click scrolls to paragraph", () => {
  const mockScrollIntoView = vi.fn();

  beforeEach(() => {
    vi.mocked(detectClauses).mockReturnValue([
      { paraId: "target-para", text: "Section 1 Preamble", depth: 0 },
    ]);

    // Mount a paragraph element in the DOM that scrollIntoView can target
    const el = document.createElement("p");
    el.dataset.paraId = "target-para";
    el.scrollIntoView = mockScrollIntoView;
    document.body.appendChild(el);
  });

  afterEach(() => {
    document.body.querySelectorAll("[data-para-id]").forEach((el) => el.remove());
    mockScrollIntoView.mockReset();
  });

  it("calls scrollIntoView on the target paragraph when the clause button is clicked", () => {
    const state = makeState(makeDoc(["Section 1 Preamble"]));
    render(<DocxClauseNav state={state} />);
    const btn = screen.getByText("Section 1 Preamble");
    fireEvent.click(btn);
    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});

describe("DocxClauseNav — long text truncation", () => {
  beforeEach(() => {
    const longText = "Article 1 " + "A".repeat(80);
    vi.mocked(detectClauses).mockReturnValue([
      { paraId: "para-long", text: longText, depth: 0 },
    ]);
  });

  it("truncates clause text to 60 chars + ellipsis in the button label", () => {
    const state = makeState(makeDoc(["Article 1 " + "A".repeat(80)]));
    render(<DocxClauseNav state={state} />);
    const btn = screen.getByRole("button", { name: /Article 1/ });
    expect(btn.textContent?.length).toBeLessThanOrEqual(63); // 60 + "…" + some slack
    expect(btn.textContent).toContain("…");
  });
});
