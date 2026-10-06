import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { store, redis } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
      if (rest.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redis };
});

vi.mock("@/lib/redis", () => ({ redis }));

import {
  isOwnStoppedTurn,
  isValidTurnId,
  registerTurn,
  requestTurnAbort,
  watchTurnAbort,
  TurnAbortUnavailable,
  TurnStoppedError,
} from "@/services/canvas-turn-abort";

const TURN = "123e4567-e89b-42d3-a456-426614174000";
const owner = { turnId: TURN, userId: "user-1", orgId: "org-1", rowId: "row-1" };

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isValidTurnId", () => {
  it("accepts a client-minted UUID and nothing else", () => {
    expect(isValidTurnId(TURN)).toBe(true);
    expect(isValidTurnId("turn-abc")).toBe(false);
    expect(isValidTurnId(undefined)).toBe(false);
  });
});

describe("registerTurn", () => {
  it("registers the first owner, lets the same user re-register, and refuses another user", async () => {
    expect(await registerTurn(owner)).toBe("registered");
    expect(await registerTurn(owner)).toBe("registered");
    expect(await registerTurn({ ...owner, userId: "intruder" })).toBe("conflict");
    expect(JSON.parse(store.get(`canvas:turn-owner:${TURN}`)!).userId).toBe("user-1");
  });
});

describe("requestTurnAbort", () => {
  it("returns the owner's row only to the owner, in the owner's org", async () => {
    await registerTurn(owner);

    const mine = await requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-1" });
    expect(mine.owner?.rowId).toBe("row-1");

    expect((await requestTurnAbort({ turnId: TURN, userId: "other", orgId: "org-1" })).owner).toBeNull();
    expect((await requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-2" })).owner).toBeNull();
  });

  it("always writes the caller's own key, never the owner's", async () => {
    await registerTurn(owner);
    await requestTurnAbort({ turnId: TURN, userId: "other", orgId: "org-1" });

    expect(store.has(`canvas:turn-abort:other:${TURN}`)).toBe(true);
    expect(store.has(`canvas:turn-abort:user-1:${TURN}`)).toBe(false);
  });

  it("throws TurnAbortUnavailable when Redis fails", async () => {
    redis.set.mockRejectedValueOnce(new Error("down"));
    await expect(requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-1" })).rejects.toBeInstanceOf(
      TurnAbortUnavailable,
    );
  });

  it("throws TurnAbortUnavailable when Redis hangs, instead of waiting it out", async () => {
    vi.useFakeTimers();
    redis.set.mockReturnValueOnce(new Promise<"OK" | null>(() => {}));
    const pending = requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-1" });
    const assertion = expect(pending).rejects.toBeInstanceOf(TurnAbortUnavailable);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});

describe("isOwnStoppedTurn", () => {
  const turn = { turnId: TURN, userId: "user-1", orgId: "org-1", rowId: "row-1" };

  it("is true only for the owner's own turn, on its conversation, once they stopped it", async () => {
    await registerTurn(owner);
    expect(await isOwnStoppedTurn(turn)).toBe(false); // not stopped yet

    await requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-1" });
    expect(await isOwnStoppedTurn(turn)).toBe(true);
    expect(await isOwnStoppedTurn({ ...turn, rowId: "row-2" })).toBe(false);
    expect(await isOwnStoppedTurn({ ...turn, orgId: "org-2" })).toBe(false);
  });

  it("is false for someone else, even if they pressed Stop on it", async () => {
    await registerTurn(owner);
    await requestTurnAbort({ turnId: TURN, userId: "other", orgId: "org-1" });
    expect(await isOwnStoppedTurn({ ...turn, userId: "other" })).toBe(false);
  });

  it("is false when Redis fails", async () => {
    redis.get.mockRejectedValueOnce(new Error("down"));
    expect(await isOwnStoppedTurn(turn)).toBe(false);
  });
});

describe("watchTurnAbort", () => {
  it("aborts the turn when its owner presses Stop", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const watch = watchTurnAbort({ turnId: TURN, userId: "user-1", controller });

    await vi.advanceTimersByTimeAsync(500);
    expect(controller.signal.aborted).toBe(false);

    await requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-1" });
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(TurnStoppedError);
    watch.stop();
  });

  it("honours a Stop sent before the turn registered on its first check", async () => {
    await requestTurnAbort({ turnId: TURN, userId: "user-1", orgId: "org-1" });
    const controller = new AbortController();
    const watch = watchTurnAbort({ turnId: TURN, userId: "user-1", controller });

    await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
    watch.stop();
  });

  it("ignores a Stop from anyone but the owner", async () => {
    vi.useFakeTimers();
    await requestTurnAbort({ turnId: TURN, userId: "other", orgId: "org-1" });
    const controller = new AbortController();
    const watch = watchTurnAbort({ turnId: TURN, userId: "user-1", controller });

    await vi.advanceTimersByTimeAsync(1500);
    expect(controller.signal.aborted).toBe(false);
    watch.stop();
  });

  it("keeps the turn running when a poll fails", async () => {
    vi.useFakeTimers();
    redis.get.mockRejectedValue(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new AbortController();
    const watch = watchTurnAbort({ turnId: TURN, userId: "user-1", controller });

    await vi.advanceTimersByTimeAsync(1500);
    expect(controller.signal.aborted).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    watch.stop();
    redis.get.mockReset();
    redis.get.mockImplementation(async (key: string) => store.get(key) ?? null);
    warn.mockRestore();
  });

  it("stops polling once stopped", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const watch = watchTurnAbort({ turnId: TURN, userId: "user-1", controller });
    await vi.advanceTimersByTimeAsync(500);
    watch.stop();
    const calls = redis.get.mock.calls.length;

    await vi.advanceTimersByTimeAsync(5000);
    expect(redis.get.mock.calls.length).toBe(calls);
  });
});
