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
  reconcilePlannerSources,
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

describe("mergeServerMessages — authored-turn prefix filter", () => {
  test("server rows for a turn THIS tab authored are not merged (no double-render)", () => {
    // The authoring tab shows its own optimistic stream under local ids;
    // the server persisted that turn as `turn-1-u` / `turn-1-a0`.
    const local = [msg("local-u"), msg("local-a", "assistant")];
    const server = [
      msg("turn-1-u"),
      msg("turn-1-a0", "assistant"),
      msg("planner-x", "assistant"),
    ];

    const merged = mergeServerMessages(local, server, ["turn-1-"]);

    // Authored turn's server rows filtered out; the planner row (not
    // authored) merges in; local optimistic rows untouched.
    expect(merged.messages.map((m) => m.id)).toEqual([
      "local-u",
      "local-a",
      "planner-x",
    ]);
    expect(merged.added.map((m) => m.id)).toEqual(["planner-x"]);
  });

  test("a tab that authored nothing merges the full server turn (reopen/other viewer)", () => {
    const local: ReturnType<typeof msg>[] = [];
    const server = [msg("turn-1-u"), msg("turn-1-a0", "assistant")];

    const merged = mergeServerMessages(local, server, []);

    expect(merged.messages.map((m) => m.id)).toEqual(["turn-1-u", "turn-1-a0"]);
  });

  test("prefix filter only skips incoming server rows, never local rows", () => {
    // Even if a local row shares the prefix, it is preserved (the filter is
    // server-side only).
    const local = [msg("turn-1-u")];
    const server = [msg("turn-1-u"), msg("planner-x", "assistant")];

    const merged = mergeServerMessages(local, server, ["turn-1-"]);

    expect(merged.messages.map((m) => m.id)).toEqual(["turn-1-u", "planner-x"]);
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

describe("reconcilePlannerSources — refresh planner status in place", () => {
  type Row = {
    id: string;
    role: "user" | "assistant";
    source?: { kind?: string; featureId?: string; workflowStatus?: string } | null;
  };
  const plannerRow = (id: string, workflowStatus: string): Row => ({
    id,
    role: "assistant",
    source: { kind: "planner", featureId: "feat-1", workflowStatus },
  });

  test("swaps a stale IN_PROGRESS snapshot for the server's COMPLETED", () => {
    const local: Row[] = [
      { id: "user1", role: "user" },
      plannerRow("planner-x", "IN_PROGRESS"),
    ];
    const server: Row[] = [
      { id: "user1", role: "user" },
      plannerRow("planner-x", "COMPLETED"),
    ];
    const { messages, changed } = reconcilePlannerSources(local, server);
    expect(changed).toBe(true);
    expect(messages[1].source?.workflowStatus).toBe("COMPLETED");
    // Order + non-planner rows untouched.
    expect(messages.map((m) => m.id)).toEqual(["user1", "planner-x"]);
  });

  test("no-op (same array, changed=false) when statuses already match", () => {
    const local: Row[] = [plannerRow("planner-x", "COMPLETED")];
    const server: Row[] = [plannerRow("planner-x", "COMPLETED")];
    const result = reconcilePlannerSources(local, server);
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(local); // identity preserved → no store write
  });

  test("never adds or drops rows — only refreshes existing planner ids", () => {
    const local: Row[] = [plannerRow("planner-x", "IN_PROGRESS")];
    // Server has an extra row, but reconcile must not append it.
    const server: Row[] = [
      plannerRow("planner-x", "FAILED"),
      plannerRow("planner-y", "COMPLETED"),
    ];
    const { messages, changed } = reconcilePlannerSources(local, server);
    expect(changed).toBe(true);
    expect(messages.map((m) => m.id)).toEqual(["planner-x"]);
    expect(messages[0].source?.workflowStatus).toBe("FAILED");
  });

  test("leaves non-planner rows and rows absent on the server alone", () => {
    const local: Row[] = [
      { id: "user1", role: "user" },
      plannerRow("planner-local-only", "IN_PROGRESS"),
    ];
    const server: Row[] = [{ id: "user1", role: "user" }];
    const result = reconcilePlannerSources(local, server);
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(local);
  });
});
