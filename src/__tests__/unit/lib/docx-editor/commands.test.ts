import { describe, test, expect, beforeEach } from "vitest";
import {
  insertText,
  deleteRange,
  acceptChange,
  rejectChange,
  acceptAllChanges,
  rejectAllChanges,
  undo,
  redo,
} from "@/lib/docx-editor/commands";
import { createEditorState } from "@/lib/docx-editor/editor-state";
import { collapsed } from "@/lib/docx-editor/selection";
import {
  DocxDocument,
  DocxParagraph,
  DocxTextRun,
} from "@/lib/docx-engine/types/document";
import {
  TrackChangeType,
  TrackChangeStatus,
} from "@/lib/docx-engine/types/track-changes";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTextRun(id: string, text: string): DocxTextRun {
  return { kind: "text", id, text, properties: {} };
}

function makeParagraph(id: string, runs: DocxTextRun[]): DocxParagraph {
  return { kind: "paragraph", id, properties: {}, runs };
}

function makeDoc(paras: DocxParagraph[]): DocxDocument {
  return {
    id: "test-doc",
    filename: "test.docx",
    blocks: paras,
    comments: [],
    styles: new Map(),
    numbering: { abstractDefs: new Map(), numDefs: new Map() },
    sectionProperties: {},
    imageUrls: new Map(),
  };
}

function getAllTrackedRuns(doc: DocxDocument) {
  const runs: DocxTextRun[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      for (const run of block.runs) {
        if (run.kind === "text" && run.trackChange) runs.push(run as DocxTextRun);
      }
    }
  }
  return runs;
}

function getAllTextRuns(doc: DocxDocument) {
  const runs: DocxTextRun[] = [];
  for (const block of doc.blocks) {
    if (block.kind === "paragraph") {
      for (const run of block.runs) {
        if (run.kind === "text") runs.push(run as DocxTextRun);
      }
    }
  }
  return runs;
}

// ─── insertText ───────────────────────────────────────────────────────────────

describe("insertText", () => {
  test("produces a new EditorState with a w:ins TrackChangeMark", () => {
    const run = makeTextRun("r1", "Hello");
    const doc = makeDoc([makeParagraph("p1", [run])]);
    const state = createEditorState(doc);

    const next = insertText(state, "Alice", " world");

    const tracked = getAllTrackedRuns(next.doc);
    expect(tracked).toHaveLength(1);
    expect(tracked[0].trackChange).toMatchObject({
      type: TrackChangeType.INSERTION,
      status: TrackChangeStatus.PENDING,
      author: "Alice",
    });
    expect(tracked[0].text).toBe(" world");
  });

  test("stamps a valid ISO date string on the mark", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const state = createEditorState(doc);
    const before = Date.now();
    const next = insertText(state, "Bob", "X");
    const after = Date.now();

    const mark = getAllTrackedRuns(next.doc)[0].trackChange!;
    const ts = Date.parse(mark.date);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("appends to last paragraph when no selection", () => {
    const doc = makeDoc([
      makeParagraph("p1", [makeTextRun("r1", "First")]),
      makeParagraph("p2", [makeTextRun("r2", "Second")]),
    ]);
    const state = createEditorState(doc);
    const next = insertText(state, "Alice", "New");

    const p2 = next.doc.blocks.find((b) => b.id === "p2") as DocxParagraph;
    const lastRun = p2.runs[p2.runs.length - 1];
    expect(lastRun.trackChange?.type).toBe(TrackChangeType.INSERTION);
  });

  test("inserts after the anchor run when selection is present", () => {
    const r1 = makeTextRun("r1", "Hello");
    const doc = makeDoc([makeParagraph("p1", [r1])]);
    const state = { ...createEditorState(doc), selection: collapsed("r1", 5) };

    const next = insertText(state, "Alice", " World");

    const para = next.doc.blocks[0] as DocxParagraph;
    expect(para.runs).toHaveLength(2);
    expect(para.runs[0].id).toBe("r1");
    expect(para.runs[1].trackChange?.type).toBe(TrackChangeType.INSERTION);
  });

  test("pushes previous doc onto history stack", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const state = createEditorState(doc);
    const next = insertText(state, "Alice", "B");
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toBe(doc);
    expect(next.future).toHaveLength(0);
  });

  test("does not mutate the original state", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "X")])]);
    const state = createEditorState(doc);
    insertText(state, "Alice", "Y");
    // Original doc runs unchanged
    const para = state.doc.blocks[0] as DocxParagraph;
    expect(para.runs).toHaveLength(1);
    expect(para.runs[0].trackChange).toBeUndefined();
  });
});

// ─── acceptChange ─────────────────────────────────────────────────────────────

describe("acceptChange", () => {
  test("INSERTION accepted → run kept as plain text, trackChange removed", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "Hi")])]);
    let state = createEditorState(doc);
    state = insertText(state, "Alice", "!");

    const insRun = getAllTrackedRuns(state.doc)[0];
    const changeId = insRun.trackChange!.id;

    const accepted = acceptChange(state, changeId);
    const runs = getAllTextRuns(accepted.doc);
    const resolved = runs.find((r) => r.id === insRun.id);
    expect(resolved).toBeDefined();
    expect(resolved!.trackChange).toBeUndefined();
    expect(resolved!.text).toBe("!");
  });

  test("DELETION accepted → run removed from paragraph", () => {
    // Manually create a DELETION run
    const delRun: DocxTextRun = {
      kind: "text",
      id: "r-del",
      text: "deleted",
      properties: {},
      trackChange: {
        id: "tc-del",
        type: TrackChangeType.DELETION,
        status: TrackChangeStatus.PENDING,
        author: "Bob",
        date: new Date().toISOString(),
      },
    };
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "Before"), delRun])]);
    const state = createEditorState(doc);

    const accepted = acceptChange(state, "tc-del");
    const runs = getAllTextRuns(accepted.doc);
    expect(runs.find((r) => r.id === "r-del")).toBeUndefined();
    expect(runs.find((r) => r.id === "r1")).toBeDefined();
  });

  test("unrelated runs are not affected", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "Keep me")])]);
    let state = createEditorState(doc);
    state = insertText(state, "Alice", "New");

    const changeId = getAllTrackedRuns(state.doc)[0].trackChange!.id;
    const accepted = acceptChange(state, changeId);

    const r1 = getAllTextRuns(accepted.doc).find((r) => r.id === "r1");
    expect(r1).toBeDefined();
    expect(r1!.text).toBe("Keep me");
  });
});

// ─── rejectChange ─────────────────────────────────────────────────────────────

describe("rejectChange", () => {
  test("INSERTION rejected → run removed from paragraph", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "Hi")])]);
    let state = createEditorState(doc);
    state = insertText(state, "Alice", "!");

    const insRun = getAllTrackedRuns(state.doc)[0];
    const changeId = insRun.trackChange!.id;

    const rejected = rejectChange(state, changeId);
    const runs = getAllTextRuns(rejected.doc);
    expect(runs.find((r) => r.id === insRun.id)).toBeUndefined();
  });

  test("DELETION rejected → run kept as plain text, trackChange removed", () => {
    const delRun: DocxTextRun = {
      kind: "text",
      id: "r-del",
      text: "was deleted",
      properties: {},
      trackChange: {
        id: "tc-del",
        type: TrackChangeType.DELETION,
        status: TrackChangeStatus.PENDING,
        author: "Bob",
        date: new Date().toISOString(),
      },
    };
    const doc = makeDoc([makeParagraph("p1", [delRun])]);
    const state = createEditorState(doc);

    const rejected = rejectChange(state, "tc-del");
    const runs = getAllTextRuns(rejected.doc);
    const restored = runs.find((r) => r.id === "r-del");
    expect(restored).toBeDefined();
    expect(restored!.trackChange).toBeUndefined();
    expect(restored!.text).toBe("was deleted");
  });
});

// ─── acceptAllChanges / rejectAllChanges ──────────────────────────────────────

describe("acceptAllChanges", () => {
  test("accepts all pending insertions and drops all pending deletions", () => {
    const insRun: DocxTextRun = {
      kind: "text",
      id: "r-ins",
      text: "inserted",
      properties: {},
      trackChange: {
        id: "tc-ins",
        type: TrackChangeType.INSERTION,
        status: TrackChangeStatus.PENDING,
        author: "Alice",
        date: new Date().toISOString(),
      },
    };
    const delRun: DocxTextRun = {
      kind: "text",
      id: "r-del",
      text: "deleted",
      properties: {},
      trackChange: {
        id: "tc-del",
        type: TrackChangeType.DELETION,
        status: TrackChangeStatus.PENDING,
        author: "Bob",
        date: new Date().toISOString(),
      },
    };
    const doc = makeDoc([makeParagraph("p1", [insRun, delRun])]);
    const state = createEditorState(doc);

    const accepted = acceptAllChanges(state);
    const runs = getAllTextRuns(accepted.doc);

    const ins = runs.find((r) => r.id === "r-ins");
    expect(ins).toBeDefined();
    expect(ins!.trackChange).toBeUndefined();

    expect(runs.find((r) => r.id === "r-del")).toBeUndefined();
  });
});

describe("rejectAllChanges", () => {
  test("drops all pending insertions and restores all pending deletions", () => {
    const insRun: DocxTextRun = {
      kind: "text",
      id: "r-ins",
      text: "new text",
      properties: {},
      trackChange: {
        id: "tc-ins",
        type: TrackChangeType.INSERTION,
        status: TrackChangeStatus.PENDING,
        author: "Alice",
        date: new Date().toISOString(),
      },
    };
    const delRun: DocxTextRun = {
      kind: "text",
      id: "r-del",
      text: "old text",
      properties: {},
      trackChange: {
        id: "tc-del",
        type: TrackChangeType.DELETION,
        status: TrackChangeStatus.PENDING,
        author: "Bob",
        date: new Date().toISOString(),
      },
    };
    const doc = makeDoc([makeParagraph("p1", [insRun, delRun])]);
    const state = createEditorState(doc);

    const rejected = rejectAllChanges(state);
    const runs = getAllTextRuns(rejected.doc);

    expect(runs.find((r) => r.id === "r-ins")).toBeUndefined();

    const del = runs.find((r) => r.id === "r-del");
    expect(del).toBeDefined();
    expect(del!.trackChange).toBeUndefined();
  });
});

// ─── undo / redo ──────────────────────────────────────────────────────────────

describe("undo", () => {
  test("restores the previous doc", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const state = createEditorState(doc);
    const after = insertText(state, "Alice", "B");

    const undone = undo(after);
    expect(undone.doc).toBe(doc); // same reference
    expect(undone.history).toHaveLength(0);
    expect(undone.future).toHaveLength(1);
    expect(undone.future[0]).toBe(after.doc);
  });

  test("double undo restores original state", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const s0 = createEditorState(doc);
    const s1 = insertText(s0, "Alice", "B");
    const s2 = insertText(s1, "Alice", "C");

    const undone = undo(undo(s2));
    expect(undone.doc).toBe(doc);
    expect(undone.history).toHaveLength(0);
  });

  test("no-op when history is empty", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const state = createEditorState(doc);
    const same = undo(state);
    expect(same).toBe(state);
  });
});

describe("redo", () => {
  test("restores the next doc after undo", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const s0 = createEditorState(doc);
    const s1 = insertText(s0, "Alice", "B");

    const undone = undo(s1);
    const redone = redo(undone);

    expect(redone.doc).toBe(s1.doc);
    expect(redone.history).toHaveLength(1);
    expect(redone.future).toHaveLength(0);
  });

  test("no-op when future is empty", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const state = createEditorState(doc);
    const same = redo(state);
    expect(same).toBe(state);
  });

  test("redo is cleared after a new edit", () => {
    const doc = makeDoc([makeParagraph("p1", [makeTextRun("r1", "A")])]);
    const s0 = createEditorState(doc);
    const s1 = insertText(s0, "Alice", "B");
    const undone = undo(s1);
    const s2 = insertText(undone, "Bob", "C"); // new edit clears future

    expect(s2.future).toHaveLength(0);
  });
});
