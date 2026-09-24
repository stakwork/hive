/**
 * `lib/utils/strut-links` — the Hive links into the org strut view.
 *
 * The contract under test is the one `StrutView` reads: strut's own query
 * packed as ONE `?strut=` param on `/org/<login>/strut`. So the assertions
 * unpack each link exactly the way the view does (`URLSearchParams` twice)
 * and expect strut's params back byte for byte.
 */

// @vitest-environment node

import { describe, expect, it } from "vitest";

import { STRUT_DEEP_LINK_PARAM, strutRunDeepLink, strutViewPath } from "@/lib/utils/strut-links";

/** What `StrutView.readDeepLink` recovers from a Hive URL. */
function readAsStrutView(path: string): Record<string, string> | null {
  const packed = new URL(path, "https://hive.test").searchParams.get(STRUT_DEEP_LINK_PARAM);
  return packed === null ? null : Object.fromEntries(new URLSearchParams(packed));
}

describe("strutRunDeepLink", () => {
  it("is strut's own query for a run: wf + run", () => {
    expect(strutRunDeepLink("code-change-propose", "1790000000000")).toBe("wf=code-change-propose&run=1790000000000");
  });

  it("escapes a run id that would otherwise break the query", () => {
    const link = strutRunDeepLink("wf", "a b&c=d#e");
    expect(Object.fromEntries(new URLSearchParams(link))).toEqual({ wf: "wf", run: "a b&c=d#e" });
  });
});

describe("strutViewPath", () => {
  it("packs the deep link as the single ?strut= param on the org strut view", () => {
    expect(strutViewPath("acme", "wf=code-change-propose&run=1790000000000")).toBe(
      "/org/acme/strut?strut=wf%3Dcode-change-propose%26run%3D1790000000000",
    );
  });

  it("is the bare view without a link", () => {
    expect(strutViewPath("acme")).toBe("/org/acme/strut");
    expect(strutViewPath("acme", "")).toBe("/org/acme/strut");
  });

  it("is root-relative — never strut's own origin", () => {
    const path = strutViewPath("acme", strutRunDeepLink("wf", "1"));
    expect(path.startsWith("/org/")).toBe(true);
    expect(path).not.toMatch(/^https?:/);
    expect(path).not.toContain("/lab");
  });

  it("encodes the org login", () => {
    expect(strutViewPath("we ird/org", "wf=x")).toBe("/org/we%20ird%2Forg/strut?strut=wf%3Dx");
  });

  it("round-trips through the view's reader, hostile run id included", () => {
    const wf = "code-change-propose";
    const run = "17&run=evil=1 #x+y";
    const path = strutViewPath("acme", strutRunDeepLink(wf, run));

    expect(readAsStrutView(path)).toEqual({ wf, run });
    // The whole link is ONE Hive param: nothing of strut's leaks onto the Hive query bare.
    const hive = new URL(path, "https://hive.test").searchParams;
    expect([...hive.keys()]).toEqual([STRUT_DEEP_LINK_PARAM]);
  });

  it("carries exactly what the view will hand the frame", () => {
    // Mirrors `StrutView.test`'s `packed()` helper: the same serialization
    // the view writes back from `strut:location`, so a minted link and a
    // mirrored one look identical.
    const packed = new URLSearchParams({ wf: "clip", run: "123" }).toString();
    expect(strutViewPath("test-org", strutRunDeepLink("clip", "123"))).toBe(
      `/org/test-org/strut?strut=${encodeURIComponent(packed)}`,
    );
  });
});
