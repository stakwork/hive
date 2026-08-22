// @vitest-environment jsdom
/**
 * Unit tests for DocxRunView.
 *
 * Covers:
 *  - Plain run rendering
 *  - Pending insertion → green underline class (other author)
 *  - Pending insertion by current author → reduced-opacity green
 *  - Pending deletion → red line-through (other author)
 *  - Pending deletion by current author → reduced-opacity red
 *  - Accepted / rejected track changes → no TC classes
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import DocxRunView from "@/components/docx-editor/DocxRunView";
import { DocxTextRun } from "@/lib/docx-engine/types/document";
import {
  TrackChangeType,
  TrackChangeStatus,
} from "@/lib/docx-engine/types/track-changes";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRun(
  overrides: Partial<DocxTextRun> = {}
): DocxTextRun {
  return {
    kind: "text",
    id: "run-1",
    text: "Hello world",
    properties: {},
    ...overrides,
  };
}

function makeMark(
  type: TrackChangeType,
  status: TrackChangeStatus,
  author: string
) {
  return {
    id: "tc-1",
    type,
    status,
    author,
    date: new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DocxRunView — plain run", () => {
  it("renders the run text", () => {
    const { getByText } = render(
      <DocxRunView run={makeRun()} currentAuthor="Alice" />
    );
    expect(getByText("Hello world")).toBeInTheDocument();
  });

  it("applies bold class when properties.bold = true", () => {
    const { container } = render(
      <DocxRunView
        run={makeRun({ properties: { bold: true } })}
        currentAuthor="Alice"
      />
    );
    expect(container.querySelector("span")?.className).toContain("font-bold");
  });

  it("applies italic class when properties.italic = true", () => {
    const { container } = render(
      <DocxRunView
        run={makeRun({ properties: { italic: true } })}
        currentAuthor="Alice"
      />
    );
    expect(container.querySelector("span")?.className).toContain("italic");
  });

  it("applies no extra classes for a plain run", () => {
    const { container } = render(
      <DocxRunView run={makeRun()} currentAuthor="Alice" />
    );
    // className should be undefined (no classes applied to a plain run)
    const className = container.querySelector("span")?.className ?? "";
    // No track-change or formatting classes
    expect(className).not.toContain("underline");
    expect(className).not.toContain("line-through");
    expect(className).not.toContain("green");
    expect(className).not.toContain("red");
  });
});

describe("DocxRunView — pending insertion (other author)", () => {
  it("renders green underline for insertion by another author", () => {
    const run = makeRun({
      trackChange: makeMark(
        TrackChangeType.INSERTION,
        TrackChangeStatus.PENDING,
        "Bob"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    const className = container.querySelector("span")?.className ?? "";
    expect(className).toContain("underline");
    expect(className).toContain("green");
    // Should use full opacity (not /50)
    expect(className).not.toContain("green-400/50");
    expect(className).toContain("green-500");
  });

  it("snapshot: insertion by other author", () => {
    const run = makeRun({
      id: "snap-run",
      text: "inserted text",
      trackChange: makeMark(
        TrackChangeType.INSERTION,
        TrackChangeStatus.PENDING,
        "Bob"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    // Snapshot the rendered span
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("DocxRunView — pending insertion (current author — own edit)", () => {
  it("renders reduced-opacity green for own insertion", () => {
    const run = makeRun({
      trackChange: makeMark(
        TrackChangeType.INSERTION,
        TrackChangeStatus.PENDING,
        "Alice"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    const className = container.querySelector("span")?.className ?? "";
    expect(className).toContain("underline");
    // Reduced-opacity variant uses /50 color tokens
    expect(className).toContain("green-400/50");
    expect(className).toContain("green-600/50");
  });

  it("snapshot: own insertion", () => {
    const run = makeRun({
      id: "snap-own-ins",
      text: "my edit",
      trackChange: makeMark(
        TrackChangeType.INSERTION,
        TrackChangeStatus.PENDING,
        "Alice"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("DocxRunView — pending deletion (other author)", () => {
  it("renders red line-through for deletion by another author", () => {
    const run = makeRun({
      trackChange: makeMark(
        TrackChangeType.DELETION,
        TrackChangeStatus.PENDING,
        "Bob"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    const className = container.querySelector("span")?.className ?? "";
    expect(className).toContain("line-through");
    expect(className).toContain("red");
    // Full opacity variant
    expect(className).toContain("red-500");
    expect(className).not.toContain("red-400/50");
  });

  it("snapshot: deletion by other author", () => {
    const run = makeRun({
      id: "snap-del",
      text: "deleted text",
      trackChange: makeMark(
        TrackChangeType.DELETION,
        TrackChangeStatus.PENDING,
        "Bob"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("DocxRunView — pending deletion (current author — own edit)", () => {
  it("renders reduced-opacity red for own deletion", () => {
    const run = makeRun({
      trackChange: makeMark(
        TrackChangeType.DELETION,
        TrackChangeStatus.PENDING,
        "Alice"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    const className = container.querySelector("span")?.className ?? "";
    expect(className).toContain("line-through");
    expect(className).toContain("red-400/50");
    expect(className).toContain("red-500/50");
  });
});

describe("DocxRunView — accepted / rejected track changes", () => {
  it("does not apply TC classes for an ACCEPTED insertion", () => {
    const run = makeRun({
      trackChange: makeMark(
        TrackChangeType.INSERTION,
        TrackChangeStatus.ACCEPTED,
        "Bob"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    const className = container.querySelector("span")?.className ?? "";
    expect(className).not.toContain("green");
    expect(className).not.toContain("red");
  });

  it("does not apply TC classes for a REJECTED deletion", () => {
    const run = makeRun({
      trackChange: makeMark(
        TrackChangeType.DELETION,
        TrackChangeStatus.REJECTED,
        "Bob"
      ),
    });
    const { container } = render(
      <DocxRunView run={run} currentAuthor="Alice" />
    );
    const className = container.querySelector("span")?.className ?? "";
    expect(className).not.toContain("green");
    expect(className).not.toContain("red");
  });
});
