/**
 * Unit tests for `src/services/attention/typeMeta.ts`.
 *
 * Verifies that:
 *   1. All four signal types have entries in `ATTENTION_TYPE_META`.
 *   2. Each entry has a non-empty colorHex and iconName.
 *   3. `SVG_PATHS` covers all `iconName` values referenced by the metadata.
 *   4. Each SVG path set has at least one non-empty path and a non-empty viewBox.
 *   5. `ATTENTION_TYPE_ORDER` matches the documented ranking and is the
 *      single source of truth consumed by `topItems.ts`.
 *   6. `typeMeta.ts` stays client-safe: its import of `topItems.ts` is
 *      type-only, so no Prisma/db code can leak into the client bundle.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ATTENTION_TYPE_META,
  ATTENTION_TYPE_ORDER,
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

// ---------------------------------------------------------------------------
// ATTENTION_TYPE_ORDER — canonical client-safe ranking
// ---------------------------------------------------------------------------

describe("ATTENTION_TYPE_ORDER", () => {
  test("covers exactly the four signal types", () => {
    expect(Object.keys(ATTENTION_TYPE_ORDER).sort()).toEqual(
      [...ALL_TYPES].sort(),
    );
  });

  test("matches the documented ranking (halted: 0 … ready-to-review: 3)", () => {
    expect(ATTENTION_TYPE_ORDER).toEqual({
      halted: 0,
      "awaiting-reply": 1,
      "plan-question": 2,
      "ready-to-review": 3,
    });
  });

  test("values are strictly increasing across the canonical key order", () => {
    const values = Object.values(ATTENTION_TYPE_ORDER);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  test("order covers the same key set as ATTENTION_TYPE_META (one source of truth)", () => {
    expect(Object.keys(ATTENTION_TYPE_ORDER).sort()).toEqual(
      Object.keys(ATTENTION_TYPE_META).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Client-safety (architecture conformance)
// ---------------------------------------------------------------------------

describe("typeMeta.ts client-safety", () => {
  const typeMetaPath = fileURLToPath(
    new URL("../../../services/attention/typeMeta.ts", import.meta.url),
  );
  const topItemsPath = fileURLToPath(
    new URL("../../../services/attention/topItems.ts", import.meta.url),
  );

  test("typeMeta.ts imports AttentionItem from topItems.ts type-only (erased at compile time)", () => {
    const source = readFileSync(typeMetaPath, "utf8");
    expect(source).toMatch(/import type \{ AttentionItem \} from "\.\/topItems";/);
  });

  test("typeMeta.ts has no server-only imports (no @/lib/db, no @prisma/client)", () => {
    const source = readFileSync(typeMetaPath, "utf8");
    expect(source).not.toMatch(/from "@\/lib\/db"/);
    expect(source).not.toMatch(/from "@prisma\/client"/);
  });

  test("topItems.ts consumes ATTENTION_TYPE_ORDER from typeMeta.ts instead of a private copy", () => {
    const source = readFileSync(topItemsPath, "utf8");
    expect(source).toMatch(
      /import \{ ATTENTION_TYPE_ORDER \} from "\.\/typeMeta";/,
    );
    // The old private ordering must not be re-declared.
    expect(source).not.toMatch(/const TYPE_ORDER/);
  });
});
