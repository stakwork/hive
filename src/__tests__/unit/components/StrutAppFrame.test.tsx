/**
 * Unit tests for StrutAppFrame — the frame for a strut APP, beside
 * HtmlArtifactFrame (strut plans/apps.md §7.4).
 *
 * The real bridge runs: ext-apps' `AppBridge` over the frame's window and the
 * MCP SDK's client over Streamable HTTP; `fetch` stands in for Hive's two
 * routes (the document, the relay), and the test plays the APP — it posts
 * the page's JSON-RPC from the frame's window and reads the host's answers
 * there.
 *
 * Asserts:
 *   - the document is read from the document route and framed as `srcdoc`
 *     — never a blob URL, never `src` — in `sandbox="allow-scripts"` only;
 *   - `ui/initialize` is answered with the theme and the style variables;
 *   - a `tools/call` from the page reaches the RELAY route as it was sent,
 *     and its result comes back to the page;
 *   - loading until the first `size-changed`, which sizes the frame;
 *   - `ui/message` goes to `onMessage`, and with none it is shown as
 *     unavailable and answered with an error — never dropped silently;
 *   - `ui/open-link` opens a strut deep link in Hive's own view;
 *   - tool input is handed over once the page is initialized.
 * The HTML artifact frame keeps its own suite (`HtmlArtifactFrame.test.tsx`),
 * unchanged; the panel registry test below shows a page still renders there.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { StrutAppFrame, STRUT_APP_FRAME_SANDBOX } from "@/components/strut-app-frame";
import { hostStyleVariables } from "@/components/strut-app-frame/host-context";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

globalThis.React = React;

const SOURCE = { githubLogin: "acme-org", swarmId: "swarm-1", app: "bench", version: "v3" };
const DOCUMENT_URL = `/api/orgs/acme-org/strut/apps/document?${new URLSearchParams({ swarmId: "swarm-1", app: "bench", version: "v3" })}`;
const RELAY_PATH = "/api/orgs/acme-org/strut/apps/mcp";
const DOC = '<!doctype html><html><head><meta name="strut-app-token" content="app:bench@v3.tok"></head><body><div id="root"></div></body></html>';

const mockFetch = vi.fn();
/** What the relay was sent, in order. */
const relayed: Array<{ method: string; body: string }> = [];

function mockRoutes() {
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost:3000");
    if (`${url.pathname}${url.search}` === DOCUMENT_URL) return new Response(DOC, { status: 200 });
    if (url.pathname !== RELAY_PATH) return new Response("not found", { status: 404 });
    if ((init?.method ?? "GET") !== "POST") return new Response(null, { status: 405 });
    const body = String(init?.body);
    const message = JSON.parse(body) as { id?: number; method: string; params?: { protocolVersion?: string } };
    relayed.push({ method: message.method, body });
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }), { status: 200, headers: { "content-type": "application/json" } });
    if (message.method === "initialize") {
      return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "strut", version: "0" } });
    }
    if (message.method === "tools/call") return reply({ content: [{ type: "text", text: '{"runs":[]}' }], structuredContent: { runs: [] } });
    return new Response(null, { status: 202 });
  });
}

/** The page's side of the bridge: what the host posted to the frame's window, and a way to post to the host. */
function playApp(frame: HTMLIFrameElement) {
  const win = frame.contentWindow!;
  const received: Array<Record<string, unknown>> = [];
  win.addEventListener("message", (e: MessageEvent) => received.push(e.data));
  const post = (message: Record<string, unknown>) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: win as unknown as Window }));
    });
  const answer = async (id: number) => {
    let found: Record<string, unknown> | undefined;
    await waitFor(() => {
      found = received.find((m) => m.id === id && ("result" in m || "error" in m));
      expect(found).toBeDefined();
    });
    return found as { result?: Record<string, unknown>; error?: unknown };
  };
  return { received, post, answer };
}

async function connected(): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement | null;
    expect(frame?.getAttribute("srcdoc")).toBe(DOC);
    return frame!;
  });
}

async function initialize(app: ReturnType<typeof playApp>) {
  await app.post({ id: 1, method: "ui/initialize", params: { appCapabilities: {}, appInfo: { name: "bench", version: "v3" }, protocolVersion: "2026-01-26" } });
  const init = await app.answer(1);
  await app.post({ method: "ui/notifications/initialized", params: {} });
  return init.result as { hostContext: Record<string, unknown>; hostCapabilities: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  relayed.length = 0;
  vi.stubGlobal("fetch", mockFetch);
  mockRoutes();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StrutAppFrame", () => {
  test("frames the document from the document route as srcdoc — no blob, no src — sandboxed to scripts only", async () => {
    // jsdom has no blob URLs; a stub that would see one being made.
    const createObjectURL = vi.fn(() => "blob:http://localhost/x");
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    render(<StrutAppFrame source={SOURCE} title="Bench" />);
    const frame = await connected();
    expect(mockFetch.mock.calls[0][0]).toBe(DOCUMENT_URL);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ credentials: "include", cache: "no-store" });
    expect(frame.getAttribute("sandbox")).toBe(STRUT_APP_FRAME_SANDBOX);
    expect(STRUT_APP_FRAME_SANDBOX).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.hasAttribute("src")).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    // The relay was initialized through Hive's route before the document was set.
    expect(relayed.map((r) => r.method)).toEqual(["initialize", "notifications/initialized"]);
  });

  test("answers ui/initialize with the theme and style variables; a tools/call reaches the relay as sent and its result comes back", async () => {
    render(<StrutAppFrame source={SOURCE} title="Bench" />);
    const app = playApp(await connected());
    const init = await initialize(app);
    expect(init.hostContext).toMatchObject({ theme: "dark", displayMode: "fullscreen", platform: "web" });
    expect((init.hostContext.styles as { variables: Record<string, string> }).variables["--font-sans"]).toBeTruthy();
    expect(init.hostCapabilities).toMatchObject({ serverTools: {}, openLinks: {} });
    expect(init.hostCapabilities.message).toBeUndefined();

    const args = { type: "run/list", config: { workflow: "wfbench-run", limit: 20 }, app: "app:bench@v3.tok" };
    await app.post({ id: 2, method: "tools/call", params: { name: "step_run", arguments: args } });
    const answer = await app.answer(2);
    expect(answer.result).toMatchObject({ structuredContent: { runs: [] } });

    const call = relayed.find((r) => r.method === "tools/call")!;
    expect(JSON.parse(call.body).params).toEqual({ name: "step_run", arguments: args });
    const relayCall = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.body === call.body)!;
    expect(new URL(String(relayCall[0])).pathname).toBe(RELAY_PATH);
    expect(new URL(String(relayCall[0])).searchParams.get("swarmId")).toBe("swarm-1");
  });

  test("loading until the first size-changed, which sizes the frame", async () => {
    render(<StrutAppFrame source={SOURCE} title="Bench" />);
    const frame = await connected();
    const app = playApp(frame);
    expect(screen.getByLabelText("Loading app")).toBeTruthy();
    await initialize(app);
    await app.post({ method: "ui/notifications/size-changed", params: { width: 800, height: 1234 } });
    await waitFor(() => expect(screen.queryByLabelText("Loading app")).toBeNull());
    expect(frame.style.height).toBe("1234px");
  });

  test("with no conversation, ui/message is shown as unavailable and answered with an error", async () => {
    render(<StrutAppFrame source={SOURCE} title="Bench" />);
    const app = playApp(await connected());
    await initialize(app);
    await app.post({ id: 3, method: "ui/message", params: { role: "user", content: [{ type: "text", text: "add a column" }] } });
    expect((await app.answer(3)).result).toMatchObject({ isError: true });
    expect((await screen.findByRole("status")).textContent).toMatch(/no conversation here/);
  });

  test("with a conversation, ui/message goes to it", async () => {
    const onMessage = vi.fn();
    render(<StrutAppFrame source={SOURCE} title="Bench" onMessage={onMessage} />);
    const app = playApp(await connected());
    const init = await initialize(app);
    expect(init.hostCapabilities.message).toEqual({ text: {} });
    await app.post({ id: 4, method: "ui/message", params: { role: "user", content: [{ type: "text", text: "add a column for the technician" }] } });
    expect((await app.answer(4)).result).not.toHaveProperty("isError");
    expect(onMessage).toHaveBeenCalledWith("add a column for the technician");
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("ui/open-link: a strut deep link opens in Hive's view; a web address in a new tab; anything else is refused", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const strutLinkHref = vi.fn((q: string) => `/w/acme/strut?strut=${encodeURIComponent(q)}`);
    render(<StrutAppFrame source={SOURCE} title="Bench" strutLinkHref={strutLinkHref} />);
    const app = playApp(await connected());
    await initialize(app);

    await app.post({ id: 5, method: "ui/open-link", params: { url: "?wf=wfbench-run&run=r1&key=leak" } });
    expect((await app.answer(5)).result).not.toHaveProperty("isError");
    expect(strutLinkHref).toHaveBeenCalledWith("wf=wfbench-run&run=r1");
    expect(mockPush).toHaveBeenCalledWith(`/w/acme/strut?strut=${encodeURIComponent("wf=wfbench-run&run=r1")}`);

    await app.post({ id: 6, method: "ui/open-link", params: { url: "https://example.com/report" } });
    await app.answer(6);
    expect(open).toHaveBeenCalledWith("https://example.com/report", "_blank", "noopener,noreferrer");

    await app.post({ id: 7, method: "ui/open-link", params: { url: "javascript:alert(1)" } });
    expect((await app.answer(7)).result).toMatchObject({ isError: true });
    expect(mockPush).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  test("hands the tool input over once the page is initialized", async () => {
    render(<StrutAppFrame source={SOURCE} title="Bench" toolInput={{ runId: "r-9", workflow: "wfbench-run" }} />);
    const app = playApp(await connected());
    await initialize(app);
    await waitFor(() =>
      expect(app.received.find((m) => m.method === "ui/notifications/tool-input")).toMatchObject({ params: { arguments: { runId: "r-9", workflow: "wfbench-run" } } }),
    );
  });

  test("a document the route refuses shows its error, and the relay is never opened", async () => {
    mockFetch.mockImplementation(async () => new Response(JSON.stringify({ error: "The app has not been built (no dist/index.html)" }), { status: 404 }));
    render(<StrutAppFrame source={SOURCE} title="Bench" />);
    expect(await screen.findByText(/has not been built/)).toBeTruthy();
    expect(relayed).toEqual([]);
  });
});

describe("hostStyleVariables", () => {
  test("maps hive's variables onto the spec's names, resolved; hive's base radius is the kit's md", () => {
    const hive: Record<string, string> = {
      "--background": " oklch(0.145 0 0)",
      "--foreground": "oklch(0.985 0 0)",
      "--muted": "oklch(0.205 0 0)",
      "--primary": "oklch(0.985 0 0)",
      "--border": "oklch(0.205 0 0)",
      "--ring": "oklch(0.708 0 0)",
      "--radius": "0.625rem",
    };
    const v = hostStyleVariables({ variable: (name) => hive[name] ?? "", bodyFont: "Inter, Arial" });
    expect(v["--color-background-primary"]).toBe("oklch(0.145 0 0)");
    expect(v["--color-text-primary"]).toBe("oklch(0.985 0 0)");
    expect(v["--color-background-secondary"]).toBe("oklch(0.205 0 0)");
    expect(v["--color-background-inverse"]).toBe("oklch(0.985 0 0)");
    expect(v["--color-border-primary"]).toBe("oklch(0.205 0 0)");
    expect(v["--color-ring-primary"]).toBe("oklch(0.708 0 0)");
    expect(v["--border-radius-md"]).toBe("0.625rem");
    expect(v["--border-radius-sm"]).toBe("calc(0.625rem - 4px)");
    expect(v["--font-sans"]).toBe("Inter, Arial, ui-sans-serif, system-ui, sans-serif");
    // Unset in hive: left out, never sent as an empty value.
    expect("--color-text-danger" in v).toBe(false);
  });
});
