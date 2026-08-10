/**
 * Unit tests for `src/services/attention/typeMeta.ts`.
 *
 * Verifies that:
 *   1. All four signal types have entries in `ATTENTION_TYPE_META`.
 *   2. Each entry has a non-empty colorHex and iconName.
 *   3. `SVG_PATHS` covers all `iconName` values referenced by the metadata.
 *   4. Each SVG path set has at least one non-empty path and a non-empty viewBox.
 */
import { describe, test, expect } from "vitest";
import {
  ATTENTION_TYPE_META,
  SVG_PATHS,
} from "@/services/attention/typeMeta";
import type { AttentionItem } from "@/services/attention/topItems";

const ALL_TYPES: AttentionItem["type"][] = [
  "halted",
  "awaiting-reply",
  "plan-question",
  "ready-to-review",
];

describe("ATTENTION_TYPE_META", () => {
  test.each(ALL_TYPES)("type '%s' has an entry", (type) => {
    expect(ATTENTION_TYPE_META[type]).toBeDefined();
  });

  test.each(ALL_TYPES)("type '%s' has a non-empty colorHex", (type) => {
    expect(ATTENTION_TYPE_META[type].colorHex).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  test.each(ALL_TYPES)("type '%s' has a non-empty colorClass", (type) => {
    expect(ATTENTION_TYPE_META[type].colorClass.length).toBeGreaterThan(0);
  });

  test.each(ALL_TYPES)("type '%s' has a non-empty label", (type) => {
    expect(ATTENTION_TYPE_META[type].label.length).toBeGreaterThan(0);
  });

  test.each(ALL_TYPES)(
    "type '%s' iconName is present in SVG_PATHS",
    (type) => {
      const { iconName } = ATTENTION_TYPE_META[type];
      expect(SVG_PATHS[iconName]).toBeDefined();
    },
  );

  test("amber signal types (halted, awaiting-reply, plan-question) share the same colorHex", () => {
    const { colorHex: haltedColor } = ATTENTION_TYPE_META["halted"];
    const { colorHex: awaitingColor } = ATTENTION_TYPE_META["awaiting-reply"];
    const { colorHex: questionColor } = ATTENTION_TYPE_META["plan-question"];
    expect(haltedColor).toBe(awaitingColor);
    expect(awaitingColor).toBe(questionColor);
  });

  test("ready-to-review has a distinct (emerald) colorHex", () => {
    const { colorHex: reviewColor } = ATTENTION_TYPE_META["ready-to-review"];
    const { colorHex: haltedColor } = ATTENTION_TYPE_META["halted"];
    expect(reviewColor).not.toBe(haltedColor);
  });
});

describe("SVG_PATHS", () => {
  const iconNames = [
    "alert-triangle",
    "message-circle-question",
    "check-circle-2",
  ] as const;

  test.each(iconNames)("icon '%s' has a non-empty viewBox", (iconName) => {
    expect(SVG_PATHS[iconName].viewBox.length).toBeGreaterThan(0);
  });

  test.each(iconNames)(
    "icon '%s' has at least one non-empty path",
    (iconName) => {
      const { paths } = SVG_PATHS[iconName];
      expect(paths.length).toBeGreaterThan(0);
      paths.forEach((p) => expect(p.length).toBeGreaterThan(0));
    },
  );

  test("alert-triangle and message-circle-question are different paths", () => {
    const at = SVG_PATHS["alert-triangle"].paths.join();
    const mcq = SVG_PATHS["message-circle-question"].paths.join();
    expect(at).not.toBe(mcq);
  });
});
