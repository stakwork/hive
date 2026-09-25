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

/**
 * The rendered frame, once its message listener is attached: the listener is
 * a passive effect on `src`, which can still be pending when `findByTitle`
 * sees the iframe commit — a message posted then is dropped.
 */
async function findFrame() {
  const iframe = (await screen.findByTitle("Strut")) as HTMLIFrameElement;
  await act(async () => {});
  return iframe;
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
    const iframe = await findFrame();
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
    await findFrame();

    nowMs += SEVEN_HOURS_MS - 60_000;
    act(() => setVisibility("visible"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Strut")).toBeTruthy();
  });

  it("re-mints and reloads the frame when the tab becomes visible after 7h", async () => {
    render(<StrutView githubLogin="test-org" />);
    await findFrame();

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
    await findFrame();

    nowMs += SEVEN_HOURS_MS + 60_000;
    act(() => setVisibility("hidden"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("deep links", () => {
    /** The strut deep link the Hive URL currently carries, decoded. */
    function hereLink() {
      return new URLSearchParams(new URLSearchParams(window.location.search).get("strut") ?? "");
    }
    function hereParams() {
      return new URLSearchParams(window.location.search);
    }
    function packed(link: Record<string, string>) {
      return encodeURIComponent(new URLSearchParams(link).toString());
    }

    it("forwards ?strut= to the frame as strut's own params, and nothing else of ours", async () => {
      window.history.replaceState(
        null,
        "",
        `/org/test-org/strut?strut=${packed({ wf: "clip", run: "123", chat: "c1" })}&key=nope&tab=x`,
      );
      render(<StrutView githubLogin="test-org" />);
      const p = frameParams((await findFrame()));
      expect(p.get("wf")).toBe("clip");
      expect(p.get("run")).toBe("123");
      expect(p.get("chat")).toBe("c1");
      expect(p.get("key")).toBe("jwt-1");
      expect(p.get("embed_origin")).toBe(window.location.origin);
      expect(p.has("tab")).toBe(false);
      expect(p.has("strut")).toBe(false);
    });

    it("mirrors strut's location into ?strut= without reloading the frame", async () => {
      window.history.replaceState(null, "", `/org/test-org/strut?strut=${packed({ wf: "old" })}&tab=x`);
      render(<StrutView githubLogin="test-org" />);
      const iframe = await findFrame();
      const src = iframe.src;

      act(() => postFromFrame({ type: "strut:location", params: { wf: "digest", run: "1790179200000" } }));

      expect(hereParams().get("strut")).toBe("wf=digest&run=1790179200000");
      expect(window.location.search).toContain("strut=wf%3Ddigest%26run%3D1790179200000");
      expect(hereParams().get("tab")).toBe("x");
      expect(window.location.pathname).toBe("/org/test-org/strut");
      expect((screen.getByTitle("Strut") as HTMLIFrameElement).src).toBe(src);
    });

    it("round-trips a key it has never heard of (peer): message → URL → frame", async () => {
      const { unmount } = render(<StrutView githubLogin="test-org" />);
      await findFrame();
      act(() => postFromFrame({ type: "strut:location", params: { peer: "swarm-2", wf: "clip" } }));
      expect(hereLink().get("peer")).toBe("swarm-2");
      expect(hereLink().get("wf")).toBe("clip");

      // A reload: a fresh mount reads the Hive URL back onto the frame.
      unmount();
      render(<StrutView githubLogin="test-org" />);
      const p = frameParams((await findFrame()));
      expect(p.get("peer")).toBe("swarm-2");
      expect(p.get("wf")).toBe("clip");
    });

    it("carries elicit while strut reports it and drops it once it's gone", async () => {
      render(<StrutView githubLogin="test-org" />);
      await findFrame();
      act(() => postFromFrame({ type: "strut:location", params: { chat: "c1", elicit: "e1" } }));
      expect(hereLink().get("chat")).toBe("c1");
      expect(hereLink().get("elicit")).toBe("e1");

      act(() => postFromFrame({ type: "strut:location", params: { chat: "c1" } }));
      expect(hereLink().get("chat")).toBe("c1");
      expect(hereLink().has("elicit")).toBe(false);
    });

    it("never carries key or embed_origin, whatever strut posts or the link says", async () => {
      window.history.replaceState(
        null,
        "",
        `/org/test-org/strut?strut=${packed({ key: "k", embed_origin: "https://evil.test", wf: "clip" })}`,
      );
      const { unmount } = render(<StrutView githubLogin="test-org" />);
      let p = frameParams((await findFrame()));
      expect(p.get("key")).toBe("jwt-1");
      expect(p.get("embed_origin")).toBe(window.location.origin);
      expect(p.get("wf")).toBe("clip");

      act(() =>
        postFromFrame({
          type: "strut:location",
          params: { wf: "digest", key: "k", embed_origin: "https://evil.test" },
        }),
      );
      expect(hereLink().get("wf")).toBe("digest");
      expect(hereLink().has("key")).toBe(false);
      expect(hereLink().has("embed_origin")).toBe(false);

      unmount();
      render(<StrutView githubLogin="test-org" />);
      p = frameParams((await findFrame()));
      expect(p.get("key")).toBe("jwt-1");
      expect(p.get("embed_origin")).toBe(window.location.origin);
      expect(p.get("wf")).toBe("digest");
    });

    it("ignores messages from other origins, other types, non-object params, and non-string values", async () => {
      render(<StrutView githubLogin="test-org" />);
      await findFrame();
      act(() => postFromFrame({ type: "strut:location", params: { wf: "evil" } }, "https://evil.test"));
      act(() => postFromFrame({ type: "other", params: { wf: "x" } }));
      act(() => postFromFrame({ type: "strut:location", params: "wf=x" }));
      act(() => postFromFrame({ type: "strut:location", params: ["wf", "x"] }));
      act(() => postFromFrame({ type: "strut:location", params: { wf: { no: 1 }, run: 42 } }));
      act(() => postFromFrame({ type: "strut:location" }));
      act(() => postFromFrame(null));
      expect(window.location.search).toBe("");

      // Per entry: the string ones survive.
      act(() => postFromFrame({ type: "strut:location", params: { wf: { no: 1 }, run: "42" } }));
      expect(hereParams().get("strut")).toBe("run=42");
    });

    it("bounds keys, values and the whole link", async () => {
      const key32 = "a" + "b".repeat(31);
      const key33 = "a" + "b".repeat(32);
      render(<StrutView githubLogin="test-org" />);
      await findFrame();
      act(() =>
        postFromFrame({
          type: "strut:location",
          params: {
            WF: "upper",
            "bad key": "space",
            "a-b": "dash",
            _x: "underscore first",
            "9x": "digit first",
            [key33]: "33 chars",
            [key32]: "32 chars",
            ok_1: "x".repeat(512),
            long: "x".repeat(513),
            empty: "",
          },
        }),
      );
      expect([...hereLink().keys()].sort()).toEqual([key32, "ok_1"]);

      // Over 2048 serialized: the update is dropped, the last link stays.
      const tooBig: Record<string, string> = {};
      for (let i = 0; i < 5; i++) tooBig[`k${i}`] = "y".repeat(500);
      act(() => postFromFrame({ type: "strut:location", params: tooBig }));
      expect([...hereLink().keys()].sort()).toEqual([key32, "ok_1"]);
    });

    // Removable with the legacy block in StrutView (links from 2026-09-22
    // until ?strut= carried the keys bare).
    it("opens a legacy ?wf=&run= link and rewrites it to ?strut= on the first strut:location", async () => {
      window.history.replaceState(null, "", "/org/test-org/strut?wf=clip&run=42&tab=x");
      render(<StrutView githubLogin="test-org" />);
      const p = frameParams((await findFrame()));
      expect(p.get("wf")).toBe("clip");
      expect(p.get("run")).toBe("42");

      act(() => postFromFrame({ type: "strut:location", params: { wf: "clip", run: "42" } }));
      expect(hereParams().get("strut")).toBe("wf=clip&run=42");
      expect(hereParams().has("wf")).toBe(false);
      expect(hereParams().has("run")).toBe(false);
      expect(hereParams().get("tab")).toBe("x");
    });

    it("prefers ?strut= over legacy bare keys when both are present", async () => {
      window.history.replaceState(null, "", `/org/test-org/strut?strut=${packed({ wf: "new" })}&wf=old&run=1`);
      render(<StrutView githubLogin="test-org" />);
      const p = frameParams((await findFrame()));
      expect(p.get("wf")).toBe("new");
      expect(p.has("run")).toBe(false);
    });

    it("removes ?strut= on empty params and leaves other Hive params untouched", async () => {
      window.history.replaceState(null, "", `/org/test-org/strut?strut=${packed({ wf: "clip" })}&tab=x`);
      render(<StrutView githubLogin="test-org" />);
      await findFrame();
      act(() => postFromFrame({ type: "strut:location", params: {} }));
      expect(window.location.search).toBe("?tab=x");
    });

    it("re-mints onto the latest reported link", async () => {
      render(<StrutView githubLogin="test-org" />);
      await findFrame();
      act(() => postFromFrame({ type: "strut:location", params: { wf: "clip", run: "42", peer: "swarm-2" } }));

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: EMBED_URL.replace("jwt-1", "jwt-2") }),
      });
      nowMs += SEVEN_HOURS_MS + 60_000;
      act(() => setVisibility("visible"));

      await waitFor(() => {
        const p = frameParams(screen.getByTitle("Strut") as HTMLIFrameElement);
        expect(p.get("key")).toBe("jwt-2");
        expect(p.get("wf")).toBe("clip");
        expect(p.get("run")).toBe("42");
        expect(p.get("peer")).toBe("swarm-2");
        expect(p.get("embed_origin")).toBe(window.location.origin);
      });
    });
  });
});
