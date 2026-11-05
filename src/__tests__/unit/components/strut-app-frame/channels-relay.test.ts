/**
 * Ported from strut kit/src/channels/channels.test.ts (the host's relay cases)
 * at commit 592257144bc683129237c4eca8773a3473b52ec3 (strut main); node:test
 * there, vitest here. Carry later strut changes over from there.
 */
import { describe, it, expect } from "vitest";
import {
  CHANNEL_JOIN_METHOD,
  CHANNEL_LEAVE_METHOD,
  CHANNEL_SEND_METHOD,
} from "@/components/strut-app-frame/channels/protocol";
import { relayChannels, type ChannelSocketLike } from "@/components/strut-app-frame/channels/relay";

const msg = (from: any, data: unknown, key?: string) => ({ from, ...(key ? { key } : {}), data, at: 1 });
const alice = { actor: "alice", client: "ca" };
const bob = { actor: "bob", client: "cb" };
const joined = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  op: "joined", channel: "lobby", client: "ca", cursor: "e.1",
  members: [{ actor: "alice", client: "ca", since: 1 }], messages, ...extra,
});

class FakeSocket implements ChannelSocketLike {
  readyState = 0;
  sent: any[] = [];
  closedWith?: number;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number) { this.closedWith = code; this.readyState = 3; }
  opened() { this.readyState = 1; this.onopen?.({}); }
  frame(f: unknown) { this.onmessage?.({ data: JSON.stringify(f) }); }
  dropped() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
}
function fakeBridge() {
  const handlers = new Map<string, (p: unknown) => unknown>();
  const toPage: any[] = [];
  const bridge = {
    setRequestHandler(method: string, _schemas: unknown, handler: (p: unknown) => unknown) { handlers.set(method, handler); },
    async notification(n: { params?: Record<string, unknown> }) { toPage.push(n.params); },
  };
  return { bridge, toPage, call: (method: string, params: unknown) => Promise.resolve(handlers.get(method)!(params)) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const { bridge, toPage, call } = fakeBridge();
  const sockets: FakeSocket[] = [];
  const opened: Array<string | undefined> = [];
  const relay = relayChannels({
    bridge,
    open: async (client) => (opened.push(client), sockets[sockets.push(new FakeSocket()) - 1]),
    retryMs: [5],
  });
  return { toPage, call, sockets, opened, relay };
}

describe("the host's relay", () => {
  it("opens one socket on the first join, joins on open, relays every frame, and queues a send until it can go", async () => {
    const { toPage, call, sockets, opened, relay } = setup();
    await expect(call(CHANNEL_SEND_METHOD, { channel: "lobby", messages: [] })).rejects.toThrow(/join the channel/);
    await call(CHANNEL_JOIN_METHOD, { channel: "lobby" });
    await call(CHANNEL_SEND_METHOD, { channel: "lobby", messages: [{ data: "early" }] });
    expect(opened).toEqual([undefined]);
    const s = sockets[0];
    s.opened();
    expect(s.sent).toEqual([{ op: "join", channel: "lobby" }, { op: "send", channel: "lobby", messages: [{ data: "early" }] }]);
    s.frame(joined([]));
    s.frame({ op: "message", channel: "lobby", cursor: "e.2", message: msg(alice, "early") });
    await tick();
    expect(toPage.map((f) => f.op)).toEqual(["joined", "message"]); // as strut sent them
    await call(CHANNEL_JOIN_METHOD, { channel: "game" });
    expect(s.sent.at(-1)).toEqual({ op: "join", channel: "game" }); // an open socket: straight on
    await call(CHANNEL_LEAVE_METHOD, { channel: "game" });
    expect(s.sent.at(-1)).toEqual({ op: "leave", channel: "game" });
    relay.close();
    expect(s.closedWith).toBe(1000); // the frame went away: a clean close
  });

  it("a drop tells the page, and the socket comes back with its client id and each channel's cursor", async () => {
    const { toPage, call, sockets, opened, relay } = setup();
    await call(CHANNEL_JOIN_METHOD, { channel: "lobby" });
    sockets[0].opened();
    sockets[0].frame(joined([], { client: "c-123", cursor: "e.4" }));
    sockets[0].frame({ op: "message", channel: "lobby", cursor: "e.7", message: msg(bob, "x") });
    sockets[0].dropped();
    await tick();
    expect(toPage.at(-1)).toEqual({ op: "status", connected: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(opened).toEqual([undefined, "c-123"]);
    sockets[1].opened();
    expect(sockets[1].sent).toEqual([{ op: "join", channel: "lobby", since: "e.7" }]);
    relay.close();
  });

  it("a ticket it cannot get is a status with the reason, and it tries again", async () => {
    const { bridge, toPage, call } = fakeBridge();
    let tries = 0;
    const relay = relayChannels({
      bridge,
      open: async () => {
        tries++;
        if (tries === 1) throw new Error("403 forbidden");
        return new FakeSocket();
      },
      retryMs: [5],
    });
    await call(CHANNEL_JOIN_METHOD, { channel: "lobby" });
    await tick();
    expect(toPage.at(-1)).toEqual({ op: "status", connected: false, error: "403 forbidden" });
    await new Promise((r) => setTimeout(r, 20));
    expect(tries).toBe(2);
    relay.close();
  });
});
