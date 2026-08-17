import { describe, test, expect } from "vitest";
import {
  resolveRunStyle,
  resolveParaStyle,
  DocxStyleCycleError,
} from "@/lib/docx-engine/resolver/style-resolver";
import { DocxStyleDef } from "@/lib/docx-engine/types/document";

function makeStyleMap(defs: DocxStyleDef[]): Map<string, DocxStyleDef> {
  const m = new Map<string, DocxStyleDef>();
  for (const d of defs) m.set(d.styleId, d);
  return m;
}

describe("resolveRunStyle", () => {
  test("returns empty object for unknown styleId", () => {
    const styles = makeStyleMap([]);
    expect(resolveRunStyle("NoSuchStyle", styles)).toEqual({});
  });

  test("returns own runProperties when no basedOn chain", () => {
    const styles = makeStyleMap([
      {
        styleId: "Bold",
        name: "Bold",
        type: "character",
        runProperties: { bold: true },
      },
    ]);
    expect(resolveRunStyle("Bold", styles)).toEqual({ bold: true });
  });

  test("merges parent runProperties with child overrides", () => {
    const styles = makeStyleMap([
      {
        styleId: "Base",
        name: "Base",
        type: "character",
        runProperties: { bold: true, fontSize: 12 },
      },
      {
        styleId: "Child",
        name: "Child",
        type: "character",
        basedOn: "Base",
        runProperties: { italic: true, fontSize: 14 },
      },
    ]);
    const result = resolveRunStyle("Child", styles);
    // child overrides fontSize, inherits bold, adds italic
    expect(result.bold).toBe(true);
    expect(result.italic).toBe(true);
    expect(result.fontSize).toBe(14);
  });

  test("throws DocxStyleCycleError on direct circular chain", () => {
    const styles = makeStyleMap([
      {
        styleId: "A",
        name: "A",
        type: "character",
        basedOn: "B",
        runProperties: {},
      },
      {
        styleId: "B",
        name: "B",
        type: "character",
        basedOn: "A",
        runProperties: {},
      },
    ]);
    expect(() => resolveRunStyle("A", styles)).toThrow(DocxStyleCycleError);
  });

  test("throws DocxStyleCycleError on self-referential style", () => {
    const styles = makeStyleMap([
      {
        styleId: "Loop",
        name: "Loop",
        type: "character",
        basedOn: "Loop",
        runProperties: {},
      },
    ]);
    expect(() => resolveRunStyle("Loop", styles)).toThrow(DocxStyleCycleError);
  });

  test("depth cap of 9 terminates without throwing for deep (non-cyclic) chains", () => {
    // Build a chain of 12 styles: s0 → s1 → s2 → … → s11
    const defs: DocxStyleDef[] = [];
    for (let i = 0; i < 12; i++) {
      defs.push({
        styleId: `s${i}`,
        name: `s${i}`,
        type: "character",
        basedOn: i < 11 ? `s${i + 1}` : undefined,
        runProperties: { fontSize: i + 1 },
      });
    }
    const styles = makeStyleMap(defs);
    // Should NOT throw — just truncate at depth 9
    expect(() => resolveRunStyle("s0", styles)).not.toThrow();
  });
});

describe("resolveParaStyle", () => {
  test("returns empty object for unknown styleId", () => {
    const styles = makeStyleMap([]);
    expect(resolveParaStyle("NoSuchStyle", styles)).toEqual({});
  });

  test("returns own paragraphProperties when no basedOn chain", () => {
    const styles = makeStyleMap([
      {
        styleId: "Heading1",
        name: "heading 1",
        type: "paragraph",
        paragraphProperties: { alignment: "center" },
      },
    ]);
    expect(resolveParaStyle("Heading1", styles)).toEqual({
      alignment: "center",
    });
  });

  test("merges parent paragraphProperties with child overrides", () => {
    const styles = makeStyleMap([
      {
        styleId: "Base",
        name: "Base",
        type: "paragraph",
        paragraphProperties: { alignment: "left", spacingBefore: 10 },
      },
      {
        styleId: "Child",
        name: "Child",
        type: "paragraph",
        basedOn: "Base",
        paragraphProperties: { alignment: "center" },
      },
    ]);
    const result = resolveParaStyle("Child", styles);
    expect(result.alignment).toBe("center");
    expect(result.spacingBefore).toBe(10);
  });

  test("throws DocxStyleCycleError on circular chain", () => {
    const styles = makeStyleMap([
      {
        styleId: "X",
        name: "X",
        type: "paragraph",
        basedOn: "Y",
        paragraphProperties: {},
      },
      {
        styleId: "Y",
        name: "Y",
        type: "paragraph",
        basedOn: "X",
        paragraphProperties: {},
      },
    ]);
    expect(() => resolveParaStyle("X", styles)).toThrow(DocxStyleCycleError);
  });

  test("DocxStyleCycleError message includes the offending styleId", () => {
    const styles = makeStyleMap([
      {
        styleId: "Circular",
        name: "Circular",
        type: "paragraph",
        basedOn: "Circular",
        paragraphProperties: {},
      },
    ]);
    try {
      resolveParaStyle("Circular", styles);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DocxStyleCycleError);
      expect((e as Error).message).toContain("Circular");
    }
  });

  test("depth cap of 9 terminates for deep non-cyclic chains", () => {
    const defs: DocxStyleDef[] = [];
    for (let i = 0; i < 12; i++) {
      defs.push({
        styleId: `p${i}`,
        name: `p${i}`,
        type: "paragraph",
        basedOn: i < 11 ? `p${i + 1}` : undefined,
        paragraphProperties: { spacingBefore: i },
      });
    }
    const styles = makeStyleMap(defs);
    expect(() => resolveParaStyle("p0", styles)).not.toThrow();
  });
});
