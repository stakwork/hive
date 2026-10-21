/**
 * The app frame's host bridge (strut plans/apps.md §7.4): ext-apps'
 * `AppBridge` over the frame's window, paired with the MCP SDK's `Client`
 * over Streamable HTTP pointed at Hive's relay
 * (`api/orgs/[githubLogin]/strut/apps/mcp`) — the pairing ext-apps is built
 * for, so the bridge forwards the page's `tools/call` to the relay by
 * itself, AS IT IS. Nothing here is hand-rolled. What is Hive's: where
 * `ui/message` and `ui/open-link` go, and the size reports.
 */
import { AppBridge, PostMessageTransport, type McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const HOST_INFO = { name: "hive", version: "1" };

export interface StrutAppHostHandlers {
  /** `ui/notifications/size-changed`: the page's natural height, in px. */
  onSize: (size: { width?: number; height?: number }) => void;
  /**
   * `ui/message`: the text, for the conversation the app sits in. Absent
   * where there is none — the host then says so (`onUnavailable`) and
   * answers the page with an error, never dropping it silently.
   */
  onMessage?: (text: string) => void | Promise<void>;
  /** `ui/open-link`: true when Hive opened it. */
  onOpenLink: (url: string) => boolean;
  /** Something the page asked for that this host cannot do here. */
  onUnavailable: (what: string) => void;
}

export interface StrutAppHostOptions {
  frame: HTMLIFrameElement;
  /** Same-origin URL of the relay for the app's swarm. */
  relayUrl: string;
  hostContext: McpUiHostContext;
  handlers: StrutAppHostHandlers;
  /** `ui/notifications/tool-input`: what the app was opened with (`{ runId, … }`). */
  toolInput?: Record<string, unknown>;
}

export interface StrutAppHostConnection {
  /** A theme change → `ui/notifications/host-context-changed`. */
  setHostContext: (context: McpUiHostContext) => void;
  close: () => Promise<void>;
}

const textOf = (content: ReadonlyArray<{ type: string; text?: unknown }> | undefined): string =>
  (content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

/**
 * Connect the relay client (its `initialize` goes through Hive's relay to
 * the swarm), then the bridge over the frame's window — BEFORE the document
 * is set, so the page's `ui/initialize` finds a host.
 */
export async function connectStrutAppHost(opts: StrutAppHostOptions): Promise<StrutAppHostConnection> {
  const client = new Client(HOST_INFO);
  // Same origin: the session cookie goes with every request; the swarm key never leaves the server.
  await client.connect(new StreamableHTTPClientTransport(new URL(opts.relayUrl, window.location.href)));
  const { handlers } = opts;
  const bridge = new AppBridge(
    client,
    HOST_INFO,
    { serverTools: {}, openLinks: {}, ...(handlers.onMessage ? { message: { text: {} } } : {}) },
    { hostContext: opts.hostContext },
  );
  bridge.onsizechange = (size) => handlers.onSize(size);
  bridge.onmessage = async (params) => {
    const text = textOf(params.content as ReadonlyArray<{ type: string; text?: unknown }>);
    if (!handlers.onMessage) {
      handlers.onUnavailable("send a message — there is no conversation here");
      return { isError: true };
    }
    if (!text) return { isError: true };
    try {
      await handlers.onMessage(text);
      return {};
    } catch {
      return { isError: true };
    }
  };
  bridge.onopenlink = async ({ url }) => (handlers.onOpenLink(url) ? {} : { isError: true });
  const { toolInput } = opts;
  if (toolInput) bridge.oninitialized = () => void bridge.sendToolInput({ arguments: toolInput });
  const win = opts.frame.contentWindow;
  if (!win) {
    await client.close().catch(() => undefined);
    throw new Error("the frame has no window");
  }
  await bridge.connect(new PostMessageTransport(win, win));
  return {
    setHostContext: (context) => bridge.setHostContext(context),
    async close() {
      await bridge.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}
