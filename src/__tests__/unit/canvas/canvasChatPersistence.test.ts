/**
 * Regression tests for the identity-based canvas-chat persistence
 * helpers (`canvasChatPersistence.ts`).
 *
 * These lock in the invariant that historically broke: the user's first
 * message could be dropped when a Pusher live-sync nudge interleaved
 * with the auto-save delta (the old count-based bookkeeping shifted the
 * save window by one). With id-based tracking + merge-by-id, message
 * loss is structurally impossible.
 */
import { describe, test, expect } from "vitest";
import {
  seedPersistedIds,
  computeUnsaved,
  mergeServerMessages,
  type PersistableMessage,
} from "@/app/org/[githubLogin]/_state/canvasChatPersistence";

const msg = (
  id: string,
  role: "user" | "assistant" = "user",
): PersistableMessage => ({ id, role });

describe("seedPersistedIds", () => {
  test("marks the leading ephemeral seed ids as persisted", () => {
    const messages = [msg("intro", "assistant"), msg("user1"), msg("a1", "assistant")];
    const set = seedPersistedIds(messages, 1);
    expect(set.has("intro")).toBe(true);
    expect(set.has("user1")).toBe(false);
  });

  test("clamps to the available message count", () => {
    expect(seedPersistedIds([msg("only")], 5).size).toBe(1);
  });

  test("empty when no seed", () => {
    expect(seedPersistedIds([msg("user1")], 0).size).toBe(0);
  });
});

describe("computeUnsaved", () => {
  test("the unsaved lead is the first user message, never a saved assistant row", () => {
    // Seed = intro (ephemeral assistant). Persisted so far = {intro}.
    const messages = [msg("intro", "assistant"), msg("user1")];
    const persisted = new Set(["intro"]);
    const delta = computeUnsaved(messages, persisted);
    expect(delta.map((m) => m.id)).toEqual(["user1"]);
    // The creating POST therefore leads with the real user message.
    expect(delta[0].role).toBe("user");
  });

  test("returns nothing when all local messages are persisted", () => {
    const messages = [msg("user1"), msg("a1", "assistant")];
    const persisted = new Set(["user1", "a1"]);
    expect(computeUnsaved(messages, persisted)).toEqual([]);
  });
});

describe("mergeServerMessages — never loses a local message", () => {
  test("a mid-turn planner nudge ADDS the planner row, keeps user+assistant", () => {
    // Local (incl. ephemeral intro) after turn 1.
    const local = [
      msg("intro", "assistant"),
      msg("user1"),
      msg("a1", "assistant"),
    ];
    // Server fanned out a planner message (new id) — does NOT have the
    // ephemeral intro.
    const server = [msg("user1"), msg("a1", "assistant"), msg("planner-x", "assistant")];

    const merged = mergeServerMessages(local, server);

    // The user's first message survives, the intro survives, and the
    // planner row is appended (this is what renders the SubAgentRunCard).
    expect(merged.messages.map((m) => m.id)).toEqual([
      "intro",
      "user1",
      "a1",
      "planner-x",
    ]);
    expect(merged.added.map((m) => m.id)).toEqual(["planner-x"]);
  });

  test("same-length, different-content server copy cannot drop user1", () => {
    // The exact old-bug shape: server somehow lacks user1 but is the
    // same length as local. The old wholesale-replace would have
    // swapped user1 out; merge keeps it.
    const local = [msg("user1"), msg("a1", "assistant")];
    const server = [msg("a1", "assistant"), msg("planner-x", "assistant")];

    const merged = mergeServerMessages(local, server);

    expect(merged.messages.map((m) => m.id)).toContain("user1");
    expect(merged.messages.map((m) => m.id)).toEqual([
      "user1",
      "a1",
      "planner-x",
    ]);
  });

  test("no-op when server has nothing new", () => {
    const local = [msg("user1"), msg("a1", "assistant")];
    const server = [msg("user1"), msg("a1", "assistant")];
    const merged = mergeServerMessages(local, server);
    expect(merged.added).toEqual([]);
    // Returns the same reference so callers can skip the store write.
    expect(merged.messages).toBe(local);
  });
});

describe("full turn lifecycle stays consistent", () => {
  test("seed → first user turn → planner nudge keeps a complete, ordered list", () => {
    const seedCount = 1;
    let local: PersistableMessage[] = [msg("intro", "assistant")];
    const persisted = seedPersistedIds(local, seedCount);

    // User sends first message.
    local = [...local, msg("user1")];
    let delta = computeUnsaved(local, persisted);
    expect(delta.map((m) => m.id)).toEqual(["user1"]); // creating POST
    delta.forEach((m) => persisted.add(m.id)); // afterSave

    // Assistant streams + settles.
    local = [...local, msg("a1", "assistant")];
    delta = computeUnsaved(local, persisted);
    expect(delta.map((m) => m.id)).toEqual(["a1"]); // PUT append
    delta.forEach((m) => persisted.add(m.id));

    // Planner fan-out nudge arrives — server has user1, a1, planner-x.
    const server = [
      msg("user1"),
      msg("a1", "assistant"),
      msg("planner-x", "assistant"),
    ];
    const merged = mergeServerMessages(local, server);
    merged.serverIds.forEach((id) => persisted.add(id));
    local = merged.messages;

    expect(local.map((m) => m.id)).toEqual([
      "intro",
      "user1",
      "a1",
      "planner-x",
    ]);
    // Nothing left to re-save (no duplicate PUTs).
    expect(computeUnsaved(local, persisted)).toEqual([]);
  });
});
