// @vitest-environment jsdom
/**
 * The frame host's channels (strut#487): the bridge advertises
 * `experimental["strut/channels"]` only when it is given `channels`, relays
 * the page's join/send/leave over one WebSocket opened with a fresh ticket
 * per connect, hands strut's frames to the page, and closes with 1000.
 * AppBridge and the MCP client are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { bridges } = vi.hoisted(() => ({ bridges: [] as Array<Record<string, any>> }));

vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => ({
  PostMessageTransport: class {},
  AppBridge: class {
    handlers = new Map<string, (p: unknown) => unknown>();
    notifications: Array<{ method: string; params: unknown }> = [];
    constructor(public client: unknown, public info: unknown, public capabilities: unknown, public options: unknown) {
      bridges.push(this as unknown as Record<string, unknown>);
    }
    setRequestHandler(method: string, _s: unknown, h: (p: unknown) => unknown) { this.handlers.set(method, h); }
    async notification(n: { method: string; params: unknown }) { this.notifications.push(n); }
    async connect() {}
    async close() {}
    setHostContext() {}
    async sendToolInput() {}
  },
}));
vi.mock("@modelcontextprotocol/client", () => ({
  Client: class { async connect() {} async close() {} },
  StreamableHTTPClientTransport: class {},
}));

const { connectStrutAppHost } = await import("@/components/strut-app-frame/bridge");

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closedWith?: number;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code?: number) { this.closedWith = code; this.readyState = 3; }
  opened() { this.readyState = 1; this.onopen?.({}); }
  frame(f: unknown) { this.onmessage?.({ data: JSON.stringify(f) }); }
  dropped() { this.readyState = 3; this.onclose?.({}); }
}

const mockFetch = vi.fn();
let n = 0;
const frame = { contentWindow: {} } as unknown as HTMLIFrameElement;
const handlers = { onSize: vi.fn(), onOpenLink: vi.fn(() => true), onUnavailable: vi.fn() };
const channels = { ticketUrl: "/api/orgs/o/strut/apps/channel-ticket?swarmId=s1", app: "bench", version: "v3" };
const connect = (withChannels: boolean) =>
  connectStrutAppHost({ frame, relayUrl: "/relay", hostContext: {}, handlers, ...(withChannels ? { channels } : {}) });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  bridges.length = 0;
  FakeWebSocket.instances = [];
  n = 0;
  mockFetch.mockReset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockImplementation(async () => Response.json({ ticket: `t${++n}`, exp: 1, url: "wss://h/lab/channels" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("strut app frame channels", () => {
  it("advertises strut/channels with a viewer, and registers nothing without", async () => {
    await connect(true);
    expect((bridges[0].capabilities as { experimental: unknown }).experimental).toEqual({ "strut/channels": { v: 1 } });
    expect(bridges[0].handlers.has("strut/channels/join")).toBe(true);
    await connect(false);
    expect(bridges[1].capabilities).not.toHaveProperty("experimental");
    expect(bridges[1].handlers.size).toBe(0);
  });

  it("relays join/send/leave and frames over one socket opened with a ticket", async () => {
    await connect(true);
    const b = bridges[0];
    await b.handlers.get("strut/channels/join")!({ channel: "lobby" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/orgs/o/strut/apps/channel-ticket?swarmId=s1");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(init.body)).toEqual({ app: "bench", version: "v3" });
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe("wss://h/lab/channels?ticket=t1");
    ws.opened();
    await b.handlers.get("strut/channels/send")!({ channel: "lobby", messages: [{ data: 1 }] });
    await b.handlers.get("strut/channels/leave")!({ channel: "lobby" });
    expect(ws.sent).toEqual([
      { op: "join", channel: "lobby" },
      { op: "send", channel: "lobby", messages: [{ data: 1 }] },
      { op: "leave", channel: "lobby" },
    ]);
    ws.frame({ op: "error", error: "x" });
    await tick();
    expect(b.notifications).toEqual([{ method: "strut/channels/frame", params: { op: "error", error: "x" } }]);
  });

  it("mints a fresh ticket per connect, reconnects included, with the client id", async () => {
    const conn = await connect(true);
    await bridges[0].handlers.get("strut/channels/join")!({ channel: "lobby" });
    const ws = FakeWebSocket.instances[0];
    ws.opened();
    ws.frame({ op: "joined", channel: "lobby", client: "c 1", cursor: "e.1", members: [], messages: [] });
    ws.dropped();
    await new Promise((r) => setTimeout(r, 700));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances[1].url).toBe("wss://h/lab/channels?ticket=t2&client=c%201");
    await conn.close();
  });

  it("omits version from the ticket request when the frame has none", async () => {
    await connectStrutAppHost({ frame, relayUrl: "/relay", hostContext: {}, handlers, channels: { ticketUrl: channels.ticketUrl, app: "bench" } });
    await bridges[0].handlers.get("strut/channels/join")!({ channel: "lobby" });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ app: "bench" });
  });

  it("a refused ticket reaches the page as a status error", async () => {
    await connect(true);
    mockFetch.mockResolvedValueOnce(Response.json({ error: "Channels are not available to you for this app" }, { status: 403 }));
    await bridges[0].handlers.get("strut/channels/join")!({ channel: "lobby" });
    await tick();
    expect(bridges[0].notifications[0].params).toEqual({ op: "status", connected: false, error: "Channels are not available to you for this app" });
    await (await connect(false)).close();
  });

  it("closes the socket with 1000 on unmount", async () => {
    const conn = await connect(true);
    await bridges[0].handlers.get("strut/channels/join")!({ channel: "lobby" });
    const ws = FakeWebSocket.instances[0];
    ws.opened();
    await conn.close();
    expect(ws.closedWith).toBe(1000);
  });
});
