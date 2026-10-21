// @vitest-environment jsdom
/**
 * A strut job's APP in the chat's artifact panel (strut plans/apps.md §6),
 * beside a page: through the viewer registry, an `html` artifact still
 * renders in `HtmlArtifactFrame` (fetched through the reader, framed from a
 * blob) and an `app` in `StrutAppFrame` (fetched through the document route,
 * framed as srcdoc); the app's `ui/message` lands in the chat box, naming
 * the app, for the person to send on.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { artifactKind } from "@/app/org/[githubLogin]/_components/artifacts/registry";
import { parseArtifactContent, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "acme-org" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("sonner", () => ({ toast: { info: mockToast } }));

globalThis.React = React;

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const APP_KEY = `/jobs/${JOB}/files/apps/tracker/dist/index.html`;
const PAGE_KEY = `/jobs/${JOB}/files/site/index.html`;
const DOC = '<!doctype html><html><body><div id="root"></div></body></html>';
const DOCUMENT_ROUTE = `/api/orgs/acme-org/strut/apps/document?${new URLSearchParams({ swarmId: "swarm-1", job: JOB, path: "apps/tracker" })}`;
const READER = `/api/orgs/acme-org/strut/artifacts?${new URLSearchParams({ swarmId: "swarm-1", key: PAGE_KEY })}`;

const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/page") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  useCanvasChatStore.setState({ pendingInputAppend: null });
  mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost:3000");
    const at = `${url.pathname}${url.search}`;
    if (at === DOCUMENT_ROUTE || at === READER) return new Response(DOC, { status: 200 });
    if (url.pathname.endsWith("/strut/apps/mcp") && init?.method === "POST") {
      const message = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { protocolVersion?: string } };
      if (message.method !== "initialize") return new Response(null, { status: 202 });
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "strut", version: "0" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(null, { status: 405 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const appRef: ArtifactRef = { id: "tracker", kind: "app", title: "Visit tracker", source: { type: "graph", swarmId: "swarm-1", key: APP_KEY } };
const pageRef: ArtifactRef = { id: "page", kind: "html", title: "Page", source: { type: "graph", swarmId: "swarm-1", key: PAGE_KEY } };

function panel(ref: ArtifactRef, content: unknown) {
  const { Panel } = artifactKind(ref.kind);
  return render(<Panel artifact={ref} content={content as never} />);
}

describe("an app beside a page", () => {
  test("the kind: its job and directory on the swarm; a row in the chat", () => {
    expect(parseArtifactContent("app", { swarmId: "swarm-1", job: JOB, path: "apps/tracker" })).toEqual({ swarmId: "swarm-1", job: JOB, path: "apps/tracker" });
    expect(parseArtifactContent("app", { swarmId: "swarm-1", job: JOB, path: "../x" })).toBeNull();
    expect(parseArtifactContent("app", { swarmId: "swarm-1", path: "apps/tracker" })).toBeNull();
    expect(artifactKind("app").label).toBe("App");
    expect(artifactKind("app").chat?.place).toBe("row");
  });

  test("a page still renders in HtmlArtifactFrame: read through the reader, framed from a blob, never srcdoc", async () => {
    panel(pageRef, parseArtifactContent("html", { swarmId: "swarm-1", key: PAGE_KEY }));
    const frame = await waitFor(() => {
      const f = document.querySelector("iframe");
      expect(f?.getAttribute("src")).toBe("blob:http://localhost/page");
      return f!;
    });
    expect(mockFetch.mock.calls[0][0]).toBe(READER);
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  test("an app renders in the app frame: read through the document route, framed as srcdoc; its message goes to the chat box", async () => {
    panel(appRef, parseArtifactContent("app", { swarmId: "swarm-1", job: JOB, path: "apps/tracker" }));
    const frame = await waitFor(() => {
      const f = document.querySelector("iframe");
      expect(f?.getAttribute("srcdoc")).toBe(DOC);
      return f!;
    });
    expect(mockFetch.mock.calls[0][0]).toBe(DOCUMENT_ROUTE);
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");

    const win = frame.contentWindow!;
    const received: Array<Record<string, unknown>> = [];
    win.addEventListener("message", (e: MessageEvent) => received.push(e.data));
    const post = (message: Record<string, unknown>) =>
      act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: { jsonrpc: "2.0", ...message }, source: win as unknown as Window }));
      });
    await post({ id: 1, method: "ui/initialize", params: { appCapabilities: {}, appInfo: { name: "tracker", version: "0" }, protocolVersion: "2026-01-26" } });
    await waitFor(() => expect(received.find((m) => m.id === 1)).toBeDefined());
    await post({ id: 2, method: "ui/message", params: { role: "user", content: [{ type: "text", text: "add a column for the technician" }] } });
    await waitFor(() => expect(received.find((m) => m.id === 2)).toMatchObject({ result: {} }));

    expect(useCanvasChatStore.getState().pendingInputAppend).toBe('About the app "Visit tracker": add a column for the technician');
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});
