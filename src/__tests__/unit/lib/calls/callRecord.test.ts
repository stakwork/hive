/**
 * The call record (`lib/calls/callRecord.ts`): 4 h from the last request
 * from voice, never past 12 h after the call started. Beside it, the room's
 * call and the members Hive minted tickets for, which live the whole 12 h.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, hashes } = vi.hoisted(() => ({
  store: new Map<string, { value: string; ttl: number }>(),
  hashes: new Map<string, { fields: Map<string, string>; ttl: number }>(),
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    hset: vi.fn(async (k: string, field: string, value: string) => {
      const hash = hashes.get(k) ?? { fields: new Map<string, string>(), ttl: -1 };
      hashes.set(k, hash);
      hash.fields.set(field, value);
      return 1;
    }),
    hget: vi.fn(async (k: string, field: string) => hashes.get(k)?.fields.get(field) ?? null),
    get: vi.fn(async (k: string) => store.get(k)?.value ?? null),
    set: vi.fn(async (k: string, value: string, _ex: string, ttl: number) => {
      store.set(k, { value, ttl });
      return "OK";
    }),
    expire: vi.fn(async (k: string, ttl: number) => {
      const entry = store.get(k) ?? hashes.get(k);
      if (entry) entry.ttl = ttl;
      return entry ? 1 : 0;
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  },
}));

import {
  CALL_RECORD_MAX_AGE_SECONDS,
  CALL_RECORD_TTL_SECONDS,
  callKeyForRoom,
  callMaxTtl,
  callMemberOf,
  callRecordTtl,
  dropCallRoom,
  loadCallRecord,
  setCallConversation,
  storeCallMember,
  storeCallRecord,
  storeCallRoom,
} from "@/lib/calls/callRecord";

const call = { userId: "u1", orgId: "org-1", workspaceSlug: "acme", roomName: "room-1" };

beforeEach(() => {
  store.clear();
  hashes.clear();
});

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

describe("who is on the call", () => {
  const start = Date.parse("2026-10-26T08:00:00Z");
  const createdAt = new Date(start).toISOString();

  it("callMaxTtl: what is left of the 12 h, never the sliding 4 h", () => {
    expect(callMaxTtl({ createdAt }, start + 60_000)).toBe(CALL_RECORD_MAX_AGE_SECONDS - 60);
    expect(callMaxTtl({ createdAt }, start + 10 * 3600_000)).toBe(2 * 3600);
    expect(callMaxTtl({ createdAt: "not a date" })).toBe(0);
  });

  it("the room names its call for 12 h, until dropped", async () => {
    await storeCallRoom("sphinx.call.-room-1", "ck1");
    expect(store.get("call-room:sphinx.call.-room-1")).toEqual({ value: "ck1", ttl: CALL_RECORD_MAX_AGE_SECONDS });
    expect(await callKeyForRoom("sphinx.call.-room-1")).toBe("ck1");
    expect(await callKeyForRoom("sphinx.call.-room-2")).toBeNull();
    await dropCallRoom("sphinx.call.-room-1");
    expect(await callKeyForRoom("sphinx.call.-room-1")).toBeNull();
  });

  it("a member is the person Hive minted the identity for, on that call only, for what is left of its 12 h", async () => {
    const record = { createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() };
    await storeCallMember("ck1", record, "hive_aa", "u2");
    await storeCallMember("ck1", record, "hive_bb", "u3");

    expect(await callMemberOf("ck1", "hive_aa")).toBe("u2");
    expect(await callMemberOf("ck1", "hive_bb")).toBe("u3");
    expect(await callMemberOf("ck1", "Mallory__ab12")).toBeNull();
    expect(await callMemberOf("ck2", "hive_aa")).toBeNull();
    const ttl = hashes.get("call-members:ck1")!.ttl;
    expect(ttl).toBeGreaterThan(9 * 3600 - 5);
    expect(ttl).toBeLessThanOrEqual(9 * 3600);
  });
});
