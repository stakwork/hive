/**
 * Unit tests for the shared SharedConversation title/preview helpers.
 *
 * Regression coverage for the canvas-chat "Untitled Conversation" bug:
 * the title is generated from the FIRST user message, and a conversation
 * whose persisted message list happens to lead with an assistant message
 * (e.g. a planner fan-out row, or a creating-POST delta that started
 * after the user turn) must still resolve a meaningful title from the
 * first user message anywhere in the list — never freeze as the
 * placeholder when a user message exists.
 */
import { describe, test, expect } from "vitest";
import {
  generateTitle,
  getMessagePreview,
  UNTITLED_CONVERSATION,
} from "@/lib/ai/conversationHelpers";

describe("generateTitle", () => {
  test("uses the first user message text", () => {
    const messages = [
      { role: "user", content: "How does auth work?" },
      { role: "assistant", content: "It uses NextAuth." },
    ];
    expect(generateTitle(messages)).toBe("How does auth work?");
  });

  test("picks the first user message even when an assistant leads", () => {
    // This is the exact shape that produced "Untitled Conversation":
    // an assistant answer persisted first, the user's question second.
    const messages = [
      { role: "assistant", content: "No — it does not use extended thinking." },
      { role: "user", content: "can you make a feature plan for that?" },
    ];
    expect(generateTitle(messages)).toBe(
      "can you make a feature plan for that?",
    );
  });

  test("truncates long titles to 50 chars + ellipsis", () => {
    const long = "a".repeat(80);
    const title = generateTitle([{ role: "user", content: long }]);
    expect(title).toBe("a".repeat(50) + "...");
  });

  test("supports array-shaped content with a text part", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "array content question" },
          { type: "image", url: "x" },
        ],
      },
    ];
    expect(generateTitle(messages)).toBe("array content question");
  });

  test("returns the placeholder when there is no user message", () => {
    const messages = [
      { role: "assistant", content: "Here are the top items waiting on you:" },
    ];
    expect(generateTitle(messages)).toBe(UNTITLED_CONVERSATION);
  });

  test("returns the placeholder for empty / non-array input", () => {
    expect(generateTitle([])).toBe(UNTITLED_CONVERSATION);
    expect(generateTitle(undefined as unknown as unknown[])).toBe(
      UNTITLED_CONVERSATION,
    );
  });

  test("returns the placeholder when the first user message is blank", () => {
    expect(generateTitle([{ role: "user", content: "   " }])).toBe(
      UNTITLED_CONVERSATION,
    );
  });
});

describe("getMessagePreview", () => {
  test("returns the first user message text", () => {
    const messages = [
      { role: "assistant", content: "intro" },
      { role: "user", content: "real question" },
    ];
    expect(getMessagePreview(messages)).toBe("real question");
  });

  test("returns null when there is no user message", () => {
    expect(getMessagePreview([{ role: "assistant", content: "x" }])).toBeNull();
  });
});

/**
 * Models the PUT-route title self-heal: a row stuck on the placeholder
 * (its creating delta led with a non-user message) recomputes the title
 * the moment a user message lands. Mirrors the logic in
 * `src/app/api/orgs/[githubLogin]/chat/conversations/[conversationId]/route.ts`.
 */
describe("title self-heal logic", () => {
  function healTitle(storedTitle: string | null, allMessages: unknown[]) {
    const needsHeal = !storedTitle || storedTitle === UNTITLED_CONVERSATION;
    if (!needsHeal) return storedTitle;
    const next = generateTitle(allMessages);
    return next !== UNTITLED_CONVERSATION ? next : storedTitle;
  }

  test("heals a placeholder title once a user message exists", () => {
    const stored = UNTITLED_CONVERSATION;
    const messages = [
      { role: "assistant", content: "planner posted a plan" },
      { role: "user", content: "the real first question" },
    ];
    expect(healTitle(stored, messages)).toBe("the real first question");
  });

  test("does not overwrite an already-meaningful title", () => {
    const stored = "My existing title";
    const messages = [{ role: "user", content: "different text" }];
    expect(healTitle(stored, messages)).toBe("My existing title");
  });

  test("leaves the placeholder when still no user message", () => {
    expect(healTitle(UNTITLED_CONVERSATION, [
      { role: "assistant", content: "still no user turn" },
    ])).toBe(UNTITLED_CONVERSATION);
  });
});
