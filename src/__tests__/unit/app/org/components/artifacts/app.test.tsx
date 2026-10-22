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
import { readStrutArtifact } from "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent";
import { parseArtifactContent, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "acme-org" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("sonner", () => ({ toast: { info: mockToast } }));

globalThis.React = React;

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const APP_KEY = "/apps/tracker/v1/files/dist/index.html";
/** A job's app directory (retired on strut's side, strut plans/chained-orchestrators.md §6): no app to hive. */
const JOB_APP_KEY = `/jobs/${JOB}/files/apps/tracker/dist/index.html`;
const PAGE_KEY = `/jobs/${JOB}/files/site/index.html`;
const DOC = '<!doctype html><html><body><div id="root"></div></body></html>';
const DOCUMENT_ROUTE = `/api/orgs/acme-org/strut/apps/document?${new URLSearchParams({ swarmId: "swarm-1", app: "tracker", version: "v1" })}`;
const READER = `/api/orgs/acme-org/strut/artifacts?${new URLSearchParams({ swarmId: "swarm-1", key: PAGE_KEY })}`;
/** The builder's deliverable (strut CALLBACKS.md §4): a workspace app by name, keyed by its version's document. */
const VISITS_KEY = "/apps/visits/v2/files/dist/index.html";
const VISITS_DOCUMENT_ROUTE = `/api/orgs/acme-org/strut/apps/document?${new URLSearchParams({ swarmId: "swarm-1", app: "visits", version: "v2" })}`;

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
    if (at === DOCUMENT_ROUTE || at === VISITS_DOCUMENT_ROUTE || at === READER) return new Response(DOC, { status: 200 });
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
const visitsRef: ArtifactRef = { id: "visits", kind: "app", title: "Visits", source: { type: "graph", swarmId: "swarm-1", key: VISITS_KEY } };
const pageRef: ArtifactRef = { id: "page", kind: "html", title: "Page", source: { type: "graph", swarmId: "swarm-1", key: PAGE_KEY } };

function panel(ref: ArtifactRef, content: unknown) {
  const { Panel } = artifactKind(ref.kind);
  return render(<Panel artifact={ref} content={content as never} />);
}

describe("an app beside a page", () => {
  test("the kind: a row in the chat; a job's app directory is none", () => {
    expect(parseArtifactContent("app", { swarmId: "swarm-1", job: JOB, path: "apps/tracker" })).toBeNull();
    expect(parseArtifactContent("app", { swarmId: "swarm-1", path: "apps/tracker" })).toBeNull();
    expect(artifactKind("app").label).toBe("App");
    expect(artifactKind("app").chat?.place).toBe("row");
  });

  test("the kind, a workspace app: its name and version on the swarm; a bad name or version is none", () => {
    expect(parseArtifactContent("app", { swarmId: "swarm-1", app: "visits", version: "v2" })).toEqual({ swarmId: "swarm-1", app: "visits", version: "v2" });
    expect(parseArtifactContent("app", { swarmId: "swarm-1", app: "acme/hvac/visits" })).toEqual({ swarmId: "swarm-1", app: "acme/hvac/visits" });
    expect(parseArtifactContent("app", { swarmId: "swarm-1", app: "../x" })).toBeNull();
    expect(parseArtifactContent("app", { swarmId: "swarm-1", app: "visits", version: "latest" })).toBeNull();
    expect(parseArtifactContent("app", { app: "visits" })).toBeNull();
  });

  test("the loader reads which app an `app` ref's key names: a workspace app by name and version; a job's directory is unavailable", async () => {
    const context = { githubLogin: "acme-org" };
    await expect(readStrutArtifact(visitsRef, context)).resolves.toEqual({ swarmId: "swarm-1", app: "visits", version: "v2" });
    await expect(readStrutArtifact(appRef, context)).resolves.toEqual({ swarmId: "swarm-1", app: "tracker", version: "v1" });
    const jobApp: ArtifactRef = { ...appRef, source: { type: "graph", swarmId: "swarm-1", key: JOB_APP_KEY } };
    await expect(readStrutArtifact(jobApp, context)).rejects.toMatchObject({ reason: "unavailable" });
    const notAnApp: ArtifactRef = { ...visitsRef, source: { type: "graph", swarmId: "swarm-1", key: "/apps/visits/v2/files/dist/app.js" } };
    await expect(readStrutArtifact(notAnApp, context)).rejects.toMatchObject({ reason: "unavailable" });
  });

  test("a workspace app renders in the app frame through the document route, by name and version, as srcdoc", async () => {
    panel(visitsRef, parseArtifactContent("app", { swarmId: "swarm-1", app: "visits", version: "v2" }));
    const frame = await waitFor(() => {
      const f = document.querySelector("iframe");
      expect(f?.getAttribute("srcdoc")).toBe(DOC);
      return f!;
    });
    expect(mockFetch.mock.calls[0][0]).toBe(VISITS_DOCUMENT_ROUTE);
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
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
    panel(appRef, parseArtifactContent("app", { swarmId: "swarm-1", app: "tracker", version: "v1" }));
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
