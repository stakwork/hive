/**
 * The call record (`lib/calls/callRecord.ts`): 4 h from the last request
 * from voice, never past 12 h after the call started.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: new Map<string, { value: string; ttl: number }>() }));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k)?.value ?? null),
    set: vi.fn(async (k: string, value: string, _ex: string, ttl: number) => {
      store.set(k, { value, ttl });
      return "OK";
    }),
    expire: vi.fn(async (k: string, ttl: number) => {
      const entry = store.get(k);
      if (entry) entry.ttl = ttl;
      return entry ? 1 : 0;
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  },
}));

import {
  CALL_RECORD_TTL_SECONDS,
  callRecordTtl,
  loadCallRecord,
  setCallConversation,
  storeCallRecord,
} from "@/lib/calls/callRecord";

const call = { userId: "u1", orgId: "org-1", workspaceSlug: "acme", roomName: "room-1" };

beforeEach(() => store.clear());

describe("callRecordTtl", () => {
  const start = Date.parse("2026-10-26T08:00:00Z");
  const createdAt = new Date(start).toISOString();

  it("4 h while the call is young", () => {
    expect(callRecordTtl({ createdAt }, start + 60_000)).toBe(CALL_RECORD_TTL_SECONDS);
  });

  it("what is left of the 12 h once that is less", () => {
    expect(callRecordTtl({ createdAt }, start + 10 * 3600_000)).toBe(2 * 3600);
  });

  it("nothing past 12 h, or for a record with no start", () => {
    expect(callRecordTtl({ createdAt }, start + 12 * 3600_000 + 1_000)).toBeLessThanOrEqual(0);
    expect(callRecordTtl({ createdAt: "not a date" })).toBe(0);
  });
});

describe("the record in Redis", () => {
  it("is written beside the token with no conversation, and a request refreshes it", async () => {
    await storeCallRecord("ck1", call);
    const stored = store.get("call:ck1")!;
    expect(stored.ttl).toBe(CALL_RECORD_TTL_SECONDS);
    expect(JSON.parse(stored.value)).toMatchObject({ ...call, conversationId: null });

    stored.ttl = 5;
    expect(await loadCallRecord("ck1")).toMatchObject({ ...call, conversationId: null });
    expect(store.get("call:ck1")!.ttl).toBe(CALL_RECORD_TTL_SECONDS);
  });

  it("keeps its conversation once the first turn sets it", async () => {
    await storeCallRecord("ck1", call);
    const record = (await loadCallRecord("ck1"))!;
    await setCallConversation("ck1", record, "conv-1");
    expect(await loadCallRecord("ck1")).toMatchObject({ conversationId: "conv-1" });
  });

  it("a call past 12 h is gone, and unknown keys are null", async () => {
    store.set("call:old", {
      value: JSON.stringify({ ...call, conversationId: null, createdAt: new Date(Date.now() - 13 * 3600_000).toISOString() }),
      ttl: 60,
    });
    expect(await loadCallRecord("old")).toBeNull();
    expect(store.has("call:old")).toBe(false);
    expect(await loadCallRecord("nope")).toBeNull();
  });
});
