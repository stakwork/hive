// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { StrutView } from "@/app/org/[githubLogin]/_components/StrutView";

const SEVEN_HOURS_MS = 7 * 60 * 60 * 1000;
const EMBED_URL = "https://swarm-abc.sphinx.chat:3355/lab/?key=jwt-1";
const FRAME_ORIGIN = "https://swarm-abc.sphinx.chat:3355";

function frameParams(iframe: HTMLIFrameElement) {
  return new URL(iframe.src).searchParams;
}

function postFromFrame(data: unknown, origin = FRAME_ORIGIN) {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("StrutView", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: EMBED_URL }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/org/test-org/strut");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a spinner while the embed URL is loading", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<StrutView githubLogin="test-org" />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("POSTs to the org's strut embed-url route and frames the returned URL", async () => {
    render(<StrutView githubLogin="test-org" />);
    const iframe = (await screen.findByTitle("Strut")) as HTMLIFrameElement;
    expect(iframe.src.startsWith(`${FRAME_ORIGIN}/lab/?`)).toBe(true);
    expect(frameParams(iframe).get("key")).toBe("jwt-1");
    expect(frameParams(iframe).get("embed_origin")).toBe(window.location.origin);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/test-org/strut/embed-url", {
      method: "POST",
    });
  });

  it("delegates the microphone and allows modals (dictation, confirm() on cancel/re-run)", async () => {
    render(<StrutView githubLogin="test-org" />);
    const iframe = await screen.findByTitle("Strut");
    expect(iframe.getAttribute("allow")).toContain("microphone");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-modals");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  it("surfaces the route's error message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "No swarm configured for any workspace in this org" }),
    });
    render(<StrutView githubLogin="test-org" />);
    await waitFor(() => {
      expect(screen.getByText("Strut unavailable")).toBeTruthy();
    });
    expect(screen.getByText("No swarm configured for any workspace in this org")).toBeTruthy();
    expect(screen.queryByTitle("Strut")).toBeNull();
  });

  it("falls back to the HTTP status when the error body isn't JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    render(<StrutView githubLogin="test-org" />);
    await waitFor(() => {
      expect(screen.getByText("HTTP 502")).toBeTruthy();
    });
  });

  it("does not re-mint when the tab becomes visible before the token nears expiry", async () => {
    render(<StrutView githubLogin="test-org" />);
    await screen.findByTitle("Strut");

    nowMs += SEVEN_HOURS_MS - 60_000;
    act(() => setVisibility("visible"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Strut")).toBeTruthy();
  });

  it("re-mints and reloads the frame when the tab becomes visible after 7h", async () => {
    render(<StrutView githubLogin="test-org" />);
    await screen.findByTitle("Strut");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: EMBED_URL.replace("jwt-1", "jwt-2") }),
    });
    nowMs += SEVEN_HOURS_MS + 60_000;
    act(() => setVisibility("visible"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const iframe = screen.getByTitle("Strut") as HTMLIFrameElement;
      expect(iframe.src).toContain("key=jwt-2");
    });
  });

  it("ignores the tab going hidden", async () => {
    render(<StrutView githubLogin="test-org" />);
    await screen.findByTitle("Strut");

    nowMs += SEVEN_HOURS_MS + 60_000;
    act(() => setVisibility("hidden"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("deep links", () => {
    it("forwards the page's deep-link params to the frame, and nothing else", async () => {
      window.history.replaceState(null, "", "/org/test-org/strut?wf=clip&run=123&chat=c1&key=nope&tab=x");
      render(<StrutView githubLogin="test-org" />);
      const p = frameParams((await screen.findByTitle("Strut")) as HTMLIFrameElement);
      expect(p.get("wf")).toBe("clip");
      expect(p.get("run")).toBe("123");
      expect(p.get("chat")).toBe("c1");
      expect(p.get("key")).toBe("jwt-1");
      expect(p.has("tab")).toBe(false);
    });

    it("mirrors strut's location messages into the address bar without reloading the frame", async () => {
      window.history.replaceState(null, "", "/org/test-org/strut?wf=old&tab=x");
      render(<StrutView githubLogin="test-org" />);
      const iframe = (await screen.findByTitle("Strut")) as HTMLIFrameElement;
      const src = iframe.src;

      act(() => postFromFrame({ type: "strut:location", params: { wf: "clip", run: "42" } }));

      const here = new URLSearchParams(window.location.search);
      expect(here.get("wf")).toBe("clip");
      expect(here.get("run")).toBe("42");
      expect(here.get("tab")).toBe("x");
      expect(window.location.pathname).toBe("/org/test-org/strut");
      expect((screen.getByTitle("Strut") as HTMLIFrameElement).src).toBe(src);
    });

    it("clears params strut no longer reports", async () => {
      window.history.replaceState(null, "", "/org/test-org/strut?wf=clip&run=42");
      render(<StrutView githubLogin="test-org" />);
      await screen.findByTitle("Strut");
      act(() => postFromFrame({ type: "strut:location", params: { wf: "clip" } }));
      expect(window.location.search).toBe("?wf=clip");
    });

    it("ignores messages from other origins, other types, and non-string values", async () => {
      render(<StrutView githubLogin="test-org" />);
      await screen.findByTitle("Strut");
      act(() => postFromFrame({ type: "strut:location", params: { wf: "evil" } }, "https://evil.test"));
      act(() => postFromFrame({ type: "other", params: { wf: "x" } }));
      act(() => postFromFrame({ type: "strut:location", params: { wf: { no: 1 }, key: "k" } }));
      expect(window.location.search).toBe("");
    });

    it("re-mints onto the latest reported deep link", async () => {
      render(<StrutView githubLogin="test-org" />);
      await screen.findByTitle("Strut");
      act(() => postFromFrame({ type: "strut:location", params: { wf: "clip", run: "42" } }));

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: EMBED_URL.replace("jwt-1", "jwt-2") }),
      });
      nowMs += SEVEN_HOURS_MS + 60_000;
      act(() => setVisibility("visible"));

      await waitFor(() => {
        const p = frameParams(screen.getByTitle("Strut") as HTMLIFrameElement);
        expect(p.get("key")).toBe("jwt-2");
        expect(p.get("run")).toBe("42");
      });
    });
  });
});
