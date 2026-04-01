/**
 * Unit tests for mergeWhiteboardElements helper in stakwork-run.ts
 *
 * Verifies the tag-and-merge strategy:
 *  - User elements (no customData.source === "ai") are always preserved
 *  - Old AI elements (customData.source === "ai") are replaced by the new set
 *  - New AI elements are appended after user elements
 */
import { describe, test, expect } from "vitest";
import { mergeWhiteboardElements } from "@/services/stakwork-run";

const userEl = { id: "user-1", type: "ellipse" };
const userEl2 = { id: "user-2", type: "text" };
const oldAiEl = { id: "old-ai-1", type: "rectangle", customData: { source: "ai" } };
const oldAiEl2 = { id: "old-ai-2", type: "arrow", customData: { source: "ai" } };
const newAiEl = { id: "new-ai-1", type: "rectangle", customData: { source: "ai" } };
const newAiEl2 = { id: "new-ai-2", type: "arrow", customData: { source: "ai" } };

describe("mergeWhiteboardElements", () => {
  test("user-only existing elements: all preserved, no AI elements in output", () => {
    const result = mergeWhiteboardElements([userEl, userEl2], [newAiEl]);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual(userEl);
    expect(result).toContainEqual(userEl2);
    expect(result).toContainEqual(newAiEl);
  });

  test("AI-only existing elements: old AI elements replaced by new AI set", () => {
    const result = mergeWhiteboardElements([oldAiEl, oldAiEl2], [newAiEl]);
    expect(result).toHaveLength(1);
    expect(result).toContainEqual(newAiEl);
    expect(result).not.toContainEqual(oldAiEl);
    expect(result).not.toContainEqual(oldAiEl2);
  });

  test("mixed existing elements: user elements preserved, old AI elements replaced, new AI elements appended", () => {
    const result = mergeWhiteboardElements(
      [userEl, oldAiEl, userEl2, oldAiEl2],
      [newAiEl, newAiEl2]
    );
    // 2 user elements + 2 new AI elements
    expect(result).toHaveLength(4);
    expect(result).toContainEqual(userEl);
    expect(result).toContainEqual(userEl2);
    expect(result).toContainEqual(newAiEl);
    expect(result).toContainEqual(newAiEl2);
    expect(result).not.toContainEqual(oldAiEl);
    expect(result).not.toContainEqual(oldAiEl2);
  });

  test("new AI elements appear after user elements in the returned array", () => {
    const result = mergeWhiteboardElements([userEl, oldAiEl], [newAiEl]);
    const userIndex = result.indexOf(userEl);
    const newAiIndex = result.indexOf(newAiEl);
    expect(userIndex).toBeLessThan(newAiIndex);
  });

  test("empty existing array: returns only aiGenerated elements", () => {
    const result = mergeWhiteboardElements([], [newAiEl, newAiEl2]);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(newAiEl);
    expect(result).toContainEqual(newAiEl2);
  });

  test("empty aiGenerated array: returns only user elements (old AI elements are dropped)", () => {
    const result = mergeWhiteboardElements([userEl, oldAiEl], []);
    expect(result).toHaveLength(1);
    expect(result).toContainEqual(userEl);
    expect(result).not.toContainEqual(oldAiEl);
  });

  test("both arrays empty: returns empty array", () => {
    const result = mergeWhiteboardElements([], []);
    expect(result).toHaveLength(0);
  });

  test("element with customData but source !== 'ai' is treated as user element", () => {
    const customEl = { id: "custom-1", type: "rectangle", customData: { source: "user" } };
    const result = mergeWhiteboardElements([customEl, oldAiEl], [newAiEl]);
    expect(result).toContainEqual(customEl);
    expect(result).not.toContainEqual(oldAiEl);
    expect(result).toContainEqual(newAiEl);
  });

  test("element with null customData is treated as user element", () => {
    const nullCustomEl = { id: "null-custom-1", type: "text", customData: null };
    const result = mergeWhiteboardElements([nullCustomEl], [newAiEl]);
    expect(result).toContainEqual(nullCustomEl);
    expect(result).toContainEqual(newAiEl);
  });

  describe("pasteId scoped removal", () => {
    const pasteId1 = "paste-session-1";
    const pasteId2 = "paste-session-2";

    const firstPasteEl = {
      id: "first-paste-1",
      type: "rectangle",
      customData: { source: "ai", pasteId: pasteId1 },
    };
    const secondPasteEl = {
      id: "second-paste-1",
      type: "rectangle",
      customData: { source: "ai", pasteId: pasteId2 },
    };
    const noSessionAiEl = {
      id: "no-session-ai",
      type: "ellipse",
      customData: { source: "ai" },
    };

    test("when pasteId provided, only elements with the same pasteId are removed", () => {
      const existing = [userEl, firstPasteEl, secondPasteEl];
      const result = mergeWhiteboardElements(existing, [newAiEl], pasteId2);

      // first paste session's elements must be preserved
      expect(result).toContainEqual(firstPasteEl);
      // second paste session's elements replaced
      expect(result).not.toContainEqual(secondPasteEl);
      // user elements always preserved
      expect(result).toContainEqual(userEl);
      // new AI elements appended
      expect(result).toContainEqual(newAiEl);
    });

    test("when pasteId provided, AI elements with no pasteId (server-generated) are preserved", () => {
      const existing = [userEl, noSessionAiEl, firstPasteEl];
      const result = mergeWhiteboardElements(existing, [newAiEl], pasteId1);

      // server-generated AI (no pasteId) is NOT removed in scoped mode
      expect(result).toContainEqual(noSessionAiEl);
      // targeted paste session is removed
      expect(result).not.toContainEqual(firstPasteEl);
      expect(result).toContainEqual(userEl);
      expect(result).toContainEqual(newAiEl);
    });

    test("when pasteId is omitted, all source=ai elements are removed (existing server behaviour)", () => {
      const existing = [userEl, firstPasteEl, secondPasteEl, noSessionAiEl];
      const result = mergeWhiteboardElements(existing, [newAiEl]);

      expect(result).toContainEqual(userEl);
      expect(result).not.toContainEqual(firstPasteEl);
      expect(result).not.toContainEqual(secondPasteEl);
      expect(result).not.toContainEqual(noSessionAiEl);
      expect(result).toContainEqual(newAiEl);
    });
  });
});
