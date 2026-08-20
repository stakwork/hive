/**
 * Unit tests for fix-snapshot.ts — the ProposedFix before/after snapshot
 * normalizer behind the single generic reader.
 *
 * Contract under test:
 *   parseFixSnapshot(fix) → { kind, title, version, refId, before, after, state, raw? }
 *   resolveFixStatus(fix) → eval_status ?? status, lowercased
 *   extractFixSnapshotProps(refId, props) → FixSnapshotProps | null
 *
 * Coverage per the feature brief:
 *   - every create-detection form: absent / "" / "null" / "{}" / parses-to-null /
 *     body key present-but-empty
 *   - kind fallback: target_type → fix_type → "unknown"
 *   - valid JSON with no body key → "empty", NOT "unparseable"
 *   - unparseable envelope → "unparseable" with raw retained
 *   - concept body under BOTH `docs` and `documentation`
 *   - prompt / workflow / unknown kinds return a rendered shape, never null
 */
import { describe, it, expect } from "vitest";
import {
  parseFixSnapshot,
  resolveFixStatus,
  extractFixSnapshotProps,
} from "@/lib/harvey-lab/fix-snapshot";
import { FIX_SNAPSHOT_SHAPES } from "@/app/api/mock/jarvis/graph/fix-snapshot-fixtures";

const conceptEdit = (old_value?: string, new_value?: string) => ({
  target_type: "concept",
  target_name: "Limitation of Liability",
  target_version: "3",
  target_ref: "concept-ref-1",
  old_value,
  new_value,
});

const AFTER = JSON.stringify({ docs: "New doctrine text." });

describe("parseFixSnapshot — kind resolution", () => {
  it("uses target_type when present", () => {
    expect(parseFixSnapshot({ target_type: "Concept" }).kind).toBe("concept");
  });

  it("falls back to legacy fix_type when target_type is absent", () => {
    expect(parseFixSnapshot({ fix_type: "concept" }).kind).toBe("concept");
  });

  it("falls back to 'unknown' when both are absent", () => {
    expect(parseFixSnapshot({}).kind).toBe("unknown");
  });

  it("treats a blank target_type as absent", () => {
    expect(parseFixSnapshot({ target_type: "  ", fix_type: "prompt" }).kind).toBe("prompt");
  });
});

describe("parseFixSnapshot — create detection (every empty-old form)", () => {
  const cases: Array<[string, string | undefined]> = [
    ["absent", undefined],
    ["empty string", ""],
    ['the string "null"', "null"],
    ['empty object "{}"', "{}"],
    ["parses to JSON null", "null"],
    ["body key present but empty", JSON.stringify({ docs: "" })],
    ["object with no body key", JSON.stringify({ revision: 3 })],
  ];

  for (const [label, oldValue] of cases) {
    it(`old_value ${label} → create`, () => {
      const parsed = parseFixSnapshot(conceptEdit(oldValue, AFTER));
      expect(parsed.state).toBe("create");
      expect(parsed.before).toBe("");
      expect(parsed.after).toBe("New doctrine text.");
    });
  }
});

describe("parseFixSnapshot — edit and body-key resolution", () => {
  it("resolves a concept body under `docs`", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.conceptEditDocs);
    expect(parsed.state).toBe("edit");
    expect(parsed.before).toContain("Consequential damages");
    expect(parsed.after).toContain("willful misconduct");
  });

  it("resolves a concept body under `documentation`", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.conceptEditDocumentation);
    expect(parsed.state).toBe("edit");
    expect(parsed.before).toContain("30 days");
    expect(parsed.after).toContain("Termination fees");
  });

  it("prefers `documentation` over `docs` when a concept envelope carries both", () => {
    const parsed = parseFixSnapshot(
      conceptEdit(
        JSON.stringify({ documentation: "canonical", docs: "legacy" }),
        JSON.stringify({ documentation: "canonical v2", docs: "legacy v2" }),
      ),
    );
    expect(parsed.before).toBe("canonical");
    expect(parsed.after).toBe("canonical v2");
  });

  it("resolves a prompt body under `text` (never null for non-concept kinds)", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.promptEdit);
    expect(parsed.kind).toBe("prompt");
    expect(parsed.state).toBe("edit");
    expect(parsed.after).toContain("reporter and circuit");
  });

  it("resolves an unmapped kind via first non-empty string value", () => {
    const parsed = parseFixSnapshot({
      target_type: "rubric",
      old_value: JSON.stringify({ weight: 2, description: "Old rubric wording" }),
      new_value: JSON.stringify({ weight: 2, description: "New rubric wording" }),
    });
    expect(parsed.kind).toBe("rubric");
    expect(parsed.state).toBe("edit");
    expect(parsed.before).toBe("Old rubric wording");
    expect(parsed.after).toBe("New rubric wording");
  });

  it("workflow kind still parses to a rendered shape (suppression is the reader's job)", () => {
    const parsed = parseFixSnapshot({
      target_type: "workflow",
      old_value: JSON.stringify({ definition: "step A" }),
      new_value: JSON.stringify({ definition: "step B" }),
    });
    expect(parsed.kind).toBe("workflow");
    expect(parsed.state).toBe("edit");
  });

  it("legacy fix_type shape parses like a concept edit", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.legacyFixType);
    expect(parsed.kind).toBe("concept");
    expect(parsed.state).toBe("edit");
    expect(parsed.after).toContain("10 business days");
  });
});

describe("parseFixSnapshot — empty vs unparseable", () => {
  it("no snapshot at all (legacy fix) → empty", () => {
    const parsed = parseFixSnapshot({ target_type: "concept" });
    expect(parsed.state).toBe("empty");
    expect(parsed.raw).toBeUndefined();
  });

  it("fix object entirely null-ish → empty, kind unknown", () => {
    const parsed = parseFixSnapshot(null);
    expect(parsed.state).toBe("empty");
    expect(parsed.kind).toBe("unknown");
  });

  it("valid JSON with no recognizable body key on either side → empty, NOT unparseable", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.conceptNoBodyKey);
    expect(parsed.state).toBe("empty");
    expect(parsed.raw).toBeUndefined();
  });

  it("unknown kind with values present resolves no body → empty (metadata renders alone)", () => {
    const parsed = parseFixSnapshot({
      target_name: "Mystery target",
      old_value: JSON.stringify({ docs: "before" }),
      new_value: JSON.stringify({ docs: "after" }),
    });
    expect(parsed.kind).toBe("unknown");
    expect(parsed.state).toBe("empty");
    expect(parsed.title).toBe("Mystery target");
  });

  it("unparseable new_value → unparseable with the raw envelope retained", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.conceptUnparseable);
    expect(parsed.state).toBe("unparseable");
    expect(parsed.raw).toBe(FIX_SNAPSHOT_SHAPES.conceptUnparseable.new_value);
  });

  it("unparseable old_value → unparseable even when new_value parses", () => {
    const parsed = parseFixSnapshot(conceptEdit("{broken", AFTER));
    expect(parsed.state).toBe("unparseable");
    expect(parsed.raw).toBe("{broken");
  });
});

describe("parseFixSnapshot — metadata passthrough", () => {
  it("carries title, version and refId", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.conceptEditDocs);
    expect(parsed.title).toBe("Limitation of Liability");
    expect(parsed.version).toBe("3");
    expect(parsed.refId).toBe("mock-concept-liability-001");
  });

  it("refId is null when target_ref is absent — link suppressed, not broken", () => {
    const parsed = parseFixSnapshot(FIX_SNAPSHOT_SHAPES.conceptEditNoRef);
    expect(parsed.refId).toBeNull();
    expect(parsed.state).toBe("edit");
  });
});

describe("resolveFixStatus", () => {
  it("eval_status wins over conflicting legacy status", () => {
    expect(resolveFixStatus({ eval_status: "accepted", status: "rejected" })).toBe("accepted");
  });

  it("falls back to legacy status when eval_status is absent", () => {
    expect(resolveFixStatus({ status: "Rejected" })).toBe("rejected");
  });

  it("returns null when neither is present", () => {
    expect(resolveFixStatus({})).toBeNull();
    expect(resolveFixStatus(null)).toBeNull();
  });
});

describe("extractFixSnapshotProps", () => {
  it("returns null for a legacy node with no snapshot fields", () => {
    expect(
      extractFixSnapshotProps("fix-1", { criterion_id: "c1", status: "accepted" }),
    ).toBeNull();
  });

  it("a bare legacy fix_type without values does NOT count as a snapshot", () => {
    expect(extractFixSnapshotProps("fix-1", { fix_type: "prompt" })).toBeNull();
  });

  it("extracts the full snapshot subset from raw node properties", () => {
    const props = extractFixSnapshotProps("fix-1", {
      ...FIX_SNAPSHOT_SHAPES.conceptEditDocs,
      eval_status: "rejected",
      status: "rejected",
      rerun_run_id: "run-9",
      unrelated_secret: "must-not-leak",
    });
    expect(props).toMatchObject({
      ref_id: "fix-1",
      target_type: "concept",
      target_name: "Limitation of Liability",
      eval_status: "rejected",
      rerun_run_id: "run-9",
    });
    expect(props && "unrelated_secret" in props).toBe(false);
  });
});
