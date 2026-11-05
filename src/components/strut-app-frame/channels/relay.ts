/* Note: ported from strut kit/src/channels/relay.ts at commit 592257144bc683129237c4eca8773a3473b52ec3 (strut main); carry later strut changes over from there. */
/** The HOST's side of channels (plans/app-channels.md §3): what a browser
 *  host (strut's UI, Hive's page) runs for each framed app that may use
 *  them. It holds ONE socket to strut for the page — opened on the page's
 *  first join, with a ticket the host mints (`open`) — and relays: the
 *  page's `strut/channels/*` requests become frames on the socket, and
 *  every frame strut sends goes to the page as it came
 *  (`strut/channels/frame`). When the socket drops it tells the page
 *  (`{ op: "status", connected: false }`) and comes back with its client id
 *  and each channel's cursor, so strut sees no leave and the page gets what
 *  it missed. Nothing is decided here.
 *
 *  No dependency: the bridge is anything with ext-apps' `AppBridge`'s
 *  `setRequestHandler` and `notification`, the socket anything shaped like
 *  the browser's `WebSocket`. */
import {
  CHANNEL_FRAME_METHOD, CHANNEL_JOIN_METHOD, CHANNEL_LEAVE_METHOD, CHANNEL_PASS_THROUGH, CHANNEL_SEND_METHOD,
  type ChannelFrame,
} from "./protocol";

/** Waits between tries to open the socket again, the last repeated. */
export const CHANNEL_RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000];
/** Sends kept while the socket is down; past it a send is refused. */
export const CHANNEL_QUEUE_MAX = 256;

/** What the relay needs of a socket: the browser's `WebSocket`. */
export interface ChannelSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  // The browser's handlers take its own event types: any, so a `WebSocket` fits.
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: any) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
}

/** What the relay needs of ext-apps' `AppBridge`. */
export interface ChannelRelayBridge {
  setRequestHandler(method: string, schemas: { params: typeof CHANNEL_PASS_THROUGH }, handler: (params: any) => unknown): void;
  notification(notification: { method: string; params?: Record<string, unknown> }): Promise<void>;
}

export interface RelayChannelsOptions {
  bridge: ChannelRelayBridge;
  /** A new socket to strut's `GET /channels`: mint a ticket for this
   *  viewer and app, and connect with it — `?client=` when given, the id the
   *  last socket had. */
  open(client?: string): Promise<ChannelSocketLike>;
  /** Tests shorten it. */
  retryMs?: readonly number[];
}

const OPEN = 1;
const channelOf = (params: unknown): string => {
  const channel = (params as { channel?: unknown } | undefined)?.channel;
  if (typeof channel !== "string" || !channel) throw new Error("channel: a channel name");
  return channel;
};

/** Register the `strut/channels/*` methods on the bridge, relayed over one
 *  socket. `close` closes it cleanly (the frame went away: strut sends
 *  `left` at once). */
export function relayChannels(opts: RelayChannelsOptions): { close(): void } {
  const { bridge, open } = opts;
  const retryMs = opts.retryMs ?? CHANNEL_RETRY_MS;
  /** The channels the page is in, with the cursor of the last frame relayed. */
  const joined = new Map<string, { cursor?: string }>();
  const queue: string[] = [];
  let socket: ChannelSocketLike | undefined;
  let opening = false;
  let client: string | undefined;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const toPage = (frame: ChannelFrame) => {
    void bridge.notification({ method: CHANNEL_FRAME_METHOD, params: frame as unknown as Record<string, unknown> }).catch(() => undefined);
  };
  const isOpen = () => socket?.readyState === OPEN;
  const write = (frame: Record<string, unknown>) => socket!.send(JSON.stringify(frame));

  const retry = () => {
    if (closed || joined.size === 0 || timer) return;
    const wait = retryMs[Math.min(attempt, retryMs.length - 1)] ?? 1_000;
    attempt++;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, wait);
  };

  const connect = async () => {
    if (closed || socket || opening || joined.size === 0) return;
    opening = true;
    let s: ChannelSocketLike;
    try {
      s = await open(client);
    } catch (err) {
      opening = false;
      toPage({ op: "status", connected: false, error: err instanceof Error ? err.message : String(err) });
      retry();
      return;
    }
    opening = false;
    if (closed) {
      s.close(1000);
      return;
    }
    socket = s;
    s.onopen = () => {
      attempt = 0;
      for (const [channel, c] of joined) write({ op: "join", channel, ...(c.cursor ? { since: c.cursor } : {}) });
      for (const text of queue.splice(0)) s.send(text);
    };
    s.onmessage = (ev: { data: unknown }) => {
      let frame: ChannelFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ChannelFrame;
      } catch {
        return;
      }
      if (frame.op === "joined") client = frame.client;
      if ((frame.op === "joined" || frame.op === "message") && joined.has(frame.channel)) joined.get(frame.channel)!.cursor = frame.cursor;
      toPage(frame);
    };
    s.onclose = () => {
      if (socket !== s) return;
      socket = undefined;
      if (closed) return;
      toPage({ op: "status", connected: false });
      retry();
    };
    s.onerror = () => undefined; // its close follows
  };

  bridge.setRequestHandler(CHANNEL_JOIN_METHOD, { params: CHANNEL_PASS_THROUGH }, async (params: unknown) => {
    const channel = channelOf(params);
    // The page asked: a fresh snapshot, not what came after an old cursor.
    joined.set(channel, {});
    if (isOpen()) write({ op: "join", channel });
    else await connect();
    return {};
  });
  bridge.setRequestHandler(CHANNEL_LEAVE_METHOD, { params: CHANNEL_PASS_THROUGH }, async (params: unknown) => {
    const channel = channelOf(params);
    joined.delete(channel);
    if (isOpen()) write({ op: "leave", channel });
    return {};
  });
  bridge.setRequestHandler(CHANNEL_SEND_METHOD, { params: CHANNEL_PASS_THROUGH }, async (params: unknown) => {
    const channel = channelOf(params);
    if (!joined.has(channel)) throw new Error("join the channel before sending to it");
    const messages = (params as { messages?: unknown }).messages;
    const frame = { op: "send", channel, messages };
    if (isOpen()) {
      write(frame);
      return {};
    }
    if (queue.length >= CHANNEL_QUEUE_MAX) throw new Error(`the connection to strut is down and ${CHANNEL_QUEUE_MAX} sends are waiting`);
    queue.push(JSON.stringify(frame));
    void connect();
    return {};
  });

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      const s = socket;
      socket = undefined;
      s?.close(1000);
    },
  };
}
