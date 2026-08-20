import { describe, it, expect } from "vitest";
import { parseFixSnapshot } from "@/lib/harvey-lab/fix-snapshot";
import type { ProposedFix } from "@/types/legal";

// Helper to build a ProposedFix with only the fields we care about
function fix(overrides: Partial<ProposedFix> = {}): ProposedFix {
  return { ref_id: "test-fix", ...overrides };
}

function jsonStr(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("parseFixSnapshot", () => {
  describe("kind resolution", () => {
    it("uses target_type when present", () => {
      const result = parseFixSnapshot(fix({ target_type: "concept" }));
      expect(result.kind).toBe("concept");
    });

    it("falls back to fix_type when target_type absent", () => {
      const result = parseFixSnapshot(fix({ fix_type: "prompt_fix" }));
      expect(result.kind).toBe("prompt_fix");
    });

    it("uses 'unknown' when both absent", () => {
      const result = parseFixSnapshot(fix({}));
      expect(result.kind).toBe("unknown");
    });
  });

  describe("create detection", () => {
    const conceptNewValue = jsonStr({ documentation: "New content" });

    it("create when old_value is absent", () => {
      const result = parseFixSnapshot(
        fix({ target_type: "concept", new_value: conceptNewValue }),
      );
      expect(result.state).toBe("create");
      expect(result.after).toBe("New content");
      expect(result.before).toBeNull();
    });

    it("create when old_value is empty string", () => {
      const result = parseFixSnapshot(
        fix({ target_type: "concept", old_value: "", new_value: conceptNewValue }),
      );
      expect(result.state).toBe("create");
    });

    it("create when old_value is the string 'null'", () => {
      const result = parseFixSnapshot(
        fix({ target_type: "concept", old_value: "null", new_value: conceptNewValue }),
      );
      expect(result.state).toBe("create");
    });

    it("create when old_value parses to null", () => {
      const result = parseFixSnapshot(
        fix({ target_type: "concept", old_value: jsonStr(null), new_value: conceptNewValue }),
      );
      expect(result.state).toBe("create");
    });

    it("create when old_value parses to empty object {}", () => {
      const result = parseFixSnapshot(
        fix({ target_type: "concept", old_value: "{}", new_value: conceptNewValue }),
      );
      expect(result.state).toBe("create");
    });

    it("create when old_value body key is missing", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          old_value: jsonStr({ other_key: "value" }),
          new_value: conceptNewValue,
        }),
      );
      expect(result.state).toBe("create");
    });

    it("create when old_value body key is empty string", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          old_value: jsonStr({ documentation: "" }),
          new_value: conceptNewValue,
        }),
      );
      expect(result.state).toBe("create");
    });
  });

  describe("edit detection", () => {
    it("edit when both sides resolve to non-empty body", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          old_value: jsonStr({ documentation: "Old content" }),
          new_value: jsonStr({ documentation: "New content" }),
        }),
      );
      expect(result.state).toBe("edit");
      expect(result.before).toBe("Old content");
      expect(result.after).toBe("New content");
    });

    it("resolves body from 'docs' key (alternate concept key)", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          old_value: jsonStr({ docs: "Old docs" }),
          new_value: jsonStr({ docs: "New docs" }),
        }),
      );
      expect(result.state).toBe("edit");
      expect(result.before).toBe("Old docs");
      expect(result.after).toBe("New docs");
    });

    it("prefers 'documentation' over 'docs' for concept kind", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          old_value: jsonStr({ documentation: "documentation value", docs: "docs value" }),
          new_value: jsonStr({ documentation: "new documentation", docs: "new docs" }),
        }),
      );
      expect(result.before).toBe("documentation value");
      expect(result.after).toBe("new documentation");
    });

    it("resolves body from 'text' key for prompt kind", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "prompt",
          old_value: jsonStr({ text: "Old prompt" }),
          new_value: jsonStr({ text: "New prompt" }),
        }),
      );
      expect(result.state).toBe("edit");
      expect(result.before).toBe("Old prompt");
      expect(result.after).toBe("New prompt");
    });

    it("resolves body from first non-empty string value for unknown kind", () => {
      // 'unknown' kind = metadata only, no body
      const result = parseFixSnapshot(
        fix({
          target_type: "other_type",
          old_value: jsonStr({ content: "Old" }),
          new_value: jsonStr({ content: "New" }),
        }),
      );
      // default body-key fallback tries "__ALL__" — first string value
      expect(result.state).toBe("edit");
      expect(result.before).toBe("Old");
      expect(result.after).toBe("New");
    });
  });

  describe("empty state", () => {
    it("empty for legacy fix with no snapshot fields", () => {
      const result = parseFixSnapshot(fix({}));
      expect(result.state).toBe("empty");
    });

    it("empty for valid JSON with no recognizable body key", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          new_value: jsonStr({ unrelated_key: 42 }),
        }),
      );
      expect(result.state).toBe("empty");
    });

    it("empty (not unparseable) for valid-JSON-no-body-key", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          new_value: jsonStr({ score: 42, unrelated: true }),
        }),
      );
      expect(result.state).toBe("empty");
    });

    it("workflow kind returns metadata-only empty state", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "workflow",
          target_name: "My Workflow",
          old_value: jsonStr({ secret: "credentials" }),
          new_value: jsonStr({ secret: "new_credentials" }),
        }),
      );
      expect(result.kind).toBe("workflow");
      expect(result.state).toBe("empty");
      expect(result.before).toBeNull();
      expect(result.after).toBeNull();
    });
  });

  describe("unparseable state", () => {
    it("unparseable when new_value is invalid JSON", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          new_value: "not json {{{",
        }),
      );
      expect(result.state).toBe("unparseable");
      expect(result.raw?.after).toBe("not json {{{");
    });

    it("does not throw on any input", () => {
      expect(() =>
        parseFixSnapshot(fix({ target_type: "concept", new_value: "{{bad}}" })),
      ).not.toThrow();
    });
  });

  describe("target metadata", () => {
    it("carries title, version, refId", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "concept",
          target_name: "Legal Concepts",
          target_version: "v3",
          target_ref: "ref-123",
          new_value: jsonStr({ documentation: "content" }),
        }),
      );
      expect(result.title).toBe("Legal Concepts");
      expect(result.version).toBe("v3");
      expect(result.refId).toBe("ref-123");
    });

    it("prompt kind returns a non-null shape, not null", () => {
      const result = parseFixSnapshot(
        fix({
          target_type: "prompt",
          new_value: jsonStr({ text: "prompt text" }),
        }),
      );
      expect(result).not.toBeNull();
      expect(result.kind).toBe("prompt");
    });
  });
});
