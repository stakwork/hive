// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import {
  HTML_ARTIFACT_NAV_MESSAGE_TYPE,
  injectHtmlArtifactNavBridge,
  isAllowedArtifactNavPath,
} from "@/lib/utils/html-artifact-nav";

describe("isAllowedArtifactNavPath", () => {
  test.each(["/org/stakwork/h/x", "/w/hive/plan/abc"])("accepts %s", (href) => {
    expect(isAllowedArtifactNavPath(href)).toBe(true);
  });

  test.each([
    "//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/api/x",
    "/\\evil",
    "/org/a b",
    "/org/a\nb",
    "/org/a\\b",
  ])("rejects %s", (href) => {
    expect(isAllowedArtifactNavPath(href)).toBe(false);
  });

  test("rejects non-strings", () => {
    for (const v of [undefined, null, 1, {}, ["/org/x"]]) {
      expect(isAllowedArtifactNavPath(v)).toBe(false);
    }
  });
});

describe("injectHtmlArtifactNavBridge", () => {
  test("inserts exactly one script at the end of body and preserves the doctype", () => {
    const out = injectHtmlArtifactNavBridge(
      "<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>",
    );
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    const doc = new DOMParser().parseFromString(out, "text/html");
    const scripts = doc.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(doc.body.lastElementChild).toBe(scripts[0]);
    expect(scripts[0].textContent).toContain(HTML_ARTIFACT_NAV_MESSAGE_TYPE);
    expect(scripts[0].textContent).toContain("postMessage");
  });

  test("adds the script and no doctype when the page has no body or doctype", () => {
    const out = injectHtmlArtifactNavBridge("<p>hi</p>");
    expect(out.startsWith("<!DOCTYPE")).toBe(false);
    expect(new DOMParser().parseFromString(out, "text/html").querySelectorAll("script")).toHaveLength(1);
  });
});
