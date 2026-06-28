/**
 * Unit tests for `hydrateServerMessages` in `useCanvasChatAutoSave`.
 *
 * Verifies that the `senderId` field is threaded correctly when
 * converting raw SharedConversation.messages JSON into store-shaped
 * `CanvasChatMessage[]`.
 */

import { describe, it, expect } from "vitest";
import { hydrateServerMessages } from "@/app/org/[githubLogin]/_state/useCanvasChatAutoSave";

describe("hydrateServerMessages — senderId propagation", () => {
  it("preserves senderId on a user message that has one", () => {
    const raw = [
      {
        id: "turn-1-u",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
        senderId: "user-abc",
      },
    ];

    const result = hydrateServerMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].senderId).toBe("user-abc");
  });

  it("leaves senderId undefined when the raw message has no senderId", () => {
    const raw = [
      {
        id: "turn-2-u",
        role: "user",
        content: "No sender",
        timestamp: new Date().toISOString(),
      },
    ];

    const result = hydrateServerMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].senderId).toBeUndefined();
  });

  it("does not copy senderId onto assistant messages (field simply absent)", () => {
    const raw = [
      {
        id: "turn-1-a0",
        role: "assistant",
        content: "I can help with that.",
        timestamp: new Date().toISOString(),
        // senderId would never be on an assistant row, but defensive check
      },
    ];

    const result = hydrateServerMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].senderId).toBeUndefined();
  });

  it("handles a mixed conversation with and without senderId", () => {
    const now = new Date().toISOString();
    const raw = [
      { id: "m-1", role: "user", content: "Hey", timestamp: now, senderId: "user-1" },
      { id: "m-2", role: "assistant", content: "Hello!", timestamp: now },
      { id: "m-3", role: "user", content: "No sender here", timestamp: now },
      { id: "m-4", role: "user", content: "From user 2", timestamp: now, senderId: "user-2" },
    ];

    const result = hydrateServerMessages(raw);
    expect(result).toHaveLength(4);
    expect(result[0].senderId).toBe("user-1");
    expect(result[1].senderId).toBeUndefined();
    expect(result[2].senderId).toBeUndefined();
    expect(result[3].senderId).toBe("user-2");
  });

  it("filters out rows with invalid roles", () => {
    const raw = [
      { id: "m-1", role: "user", content: "Valid", timestamp: new Date().toISOString() },
      { id: "m-2", role: "system", content: "Should be filtered", timestamp: new Date().toISOString() },
    ];

    const result = hydrateServerMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m-1");
  });

  it("coerces timestamp string to a Date instance", () => {
    const ts = "2025-01-15T10:30:00.000Z";
    const raw = [{ id: "m-1", role: "user", content: "Hi", timestamp: ts, senderId: "u-1" }];

    const result = hydrateServerMessages(raw);
    expect(result[0].timestamp).toBeInstanceOf(Date);
    expect(result[0].timestamp.toISOString()).toBe(ts);
  });
});
