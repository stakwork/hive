/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import {
  capturePlan,
  chunkIndexOf,
  injectSnapshotScript,
  pageHeightPx,
  pageRanges,
  parseSnapshotMessage,
  snapshotScriptSource,
} from "@/app/org/[githubLogin]/_components/artifacts/artifactPdfLayout";

describe("pageRanges", () => {
  it("is one page for a short page", () => expect(pageRanges(500, 1024)).toEqual([{ top: 0, height: 500 }]));
  it("grows with the height and covers it exactly", () => {
    const ph = pageHeightPx(1024);
    const r = pageRanges(ph * 3.5, 1024);
    expect(r).toHaveLength(4);
    expect(r[3].top + r[3].height).toBeCloseTo(Math.ceil(ph * 3.5), 5);
    expect(pageRanges(ph * 10, 1024).length).toBeGreaterThan(r.length);
  });
  it("always has a page", () => expect(pageRanges(0, 1024)).toHaveLength(1));
});

describe("capturePlan", () => {
  it("keeps 2x and one chunk for a short page", () => {
    const p = capturePlan(3000, 1024);
    expect(p.scale).toBe(2);
    expect(p.chunks).toHaveLength(1);
  });
  it("chunks a very tall page, each chunk fitting a canvas, never below 1.5x", () => {
    const p = capturePlan(60_000, 1024);
    expect(p.scale).toBeGreaterThanOrEqual(1.5);
    expect(p.chunks.length).toBeGreaterThan(1);
    for (const c of p.chunks) expect(c.height * p.scale).toBeLessThanOrEqual(16000 + 1);
    const last = p.chunks[p.chunks.length - 1];
    expect(last.top + last.height).toBeCloseTo(60_000);
  });
  it("puts every page in exactly one chunk", () => {
    const p = capturePlan(60_000, 1024);
    for (const page of pageRanges(60_000, 1024)) {
      const c = p.chunks[chunkIndexOf(p, page)];
      expect(page.top).toBeGreaterThanOrEqual(c.top - 0.5);
      expect(page.top + page.height).toBeLessThanOrEqual(c.top + c.height + 0.5);
    }
  });
});

describe("parseSnapshotMessage", () => {
  const ok = { type: "hive-pdf-snapshot", nonce: "n", html: "<p>x</p>", width: 1000, height: 2000 };
  it("accepts a matching message", () => expect(parseSnapshotMessage(ok, "n")).toEqual({ html: "<p>x</p>", width: 1000, height: 2000 }));
  it("rejects a wrong nonce, type, or body", () => {
    expect(parseSnapshotMessage(ok, "other")).toBeNull();
    expect(parseSnapshotMessage({ ...ok, type: "x" }, "n")).toBeNull();
    expect(parseSnapshotMessage({ ...ok, html: "" }, "n")).toBeNull();
    expect(parseSnapshotMessage({ ...ok, html: 3 }, "n")).toBeNull();
    expect(parseSnapshotMessage(null, "n")).toBeNull();
    expect(parseSnapshotMessage("s", "n")).toBeNull();
  });
});

describe("injectSnapshotScript", () => {
  it("adds the script before </body>", () => {
    const out = injectSnapshotScript("<html><body><p>a</p></body></html>", "abc");
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</body>"));
    expect(out).toContain('"abc"');
  });
  it("appends when there is no body", () => expect(injectSnapshotScript("<p>a</p>", "n").endsWith("</script>")).toBe(true));

  it("posts the rendered DOM with scripts stripped and form values kept", async () => {
    document.body.innerHTML = `<p id="t">Hola</p><input id="i"><script>1</script>`;
    (document.getElementById("i") as HTMLInputElement).value = "typed";
    const got = new Promise<MessageEvent>((resolve) => {
      window.addEventListener("message", (e) => e.data?.type === "hive-pdf-snapshot" && resolve(e));
    });
    const spy = vi.spyOn(window.parent, "postMessage").mockImplementation((data: unknown) => {
      window.dispatchEvent(new MessageEvent("message", { data }));
    });
    new Function(snapshotScriptSource("nn", 0))();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "hive-pdf-snapshot-request", nonce: "nn" }, source: window.parent }));
    const e = await got;
    spy.mockRestore();
    const snap = parseSnapshotMessage(e.data, "nn")!;
    expect(snap.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(snap.html).toContain("Hola");
    expect(snap.html).toContain('value="typed"');
    expect(snap.html).not.toContain("<script");
  });
});
