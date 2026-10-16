import { describe, test, expect } from "vitest";
import { MAX_CAPTCHA_SITES, normalizeSite, normalizeSites, siteAllowed } from "@/lib/captcha";

describe("normalizeSite", () => {
  test("lowercases and strips scheme, credentials, port, path, query", () => {
    expect(normalizeSite("HTTPS://User:pw@Example.COM:8443/a/b?c=1#d")).toBe("example.com");
    expect(normalizeSite("  www.Example.com/path ")).toBe("www.example.com");
    expect(normalizeSite("example.com.")).toBe("example.com");
  });

  test("rejects what is not a hostname", () => {
    for (const bad of ["", "   ", "exa mple.com", "-a.com", "a..com", "a_b.com", "https://", 5, null, "a".repeat(64) + ".com"]) {
      expect(normalizeSite(bad), String(bad)).toBeNull();
    }
  });
});

describe("normalizeSites", () => {
  test("dedupes, drops invalid, caps at 50", () => {
    expect(normalizeSites(["A.com", "https://a.com/x", "b.com", "bad host"])).toEqual(["a.com", "b.com"]);
    const many = Array.from({ length: 80 }, (_, i) => `s${i}.com`);
    expect(normalizeSites(many)).toHaveLength(MAX_CAPTCHA_SITES);
    expect(normalizeSites("nope")).toEqual([]);
  });
});

describe("siteAllowed", () => {
  test("an exact host or a subdomain matches; a lookalike does not", () => {
    const list = ["example.com"];
    expect(siteAllowed("example.com", list)).toBe(true);
    expect(siteAllowed("https://login.Example.com/x", list)).toBe(true);
    expect(siteAllowed("a.b.example.com", list)).toBe(true);
    expect(siteAllowed("notexample.com", list)).toBe(false);
    expect(siteAllowed("example.com.evil.io", list)).toBe(false);
    expect(siteAllowed("com", list)).toBe(false);
  });

  test("an empty or missing list, or a bad site, allows nothing", () => {
    expect(siteAllowed("example.com", [])).toBe(false);
    expect(siteAllowed("example.com", undefined)).toBe(false);
    expect(siteAllowed("", ["example.com"])).toBe(false);
  });
});
