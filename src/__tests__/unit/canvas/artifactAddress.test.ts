/**
 * The addresses artifacts carry (`_components/artifacts/address.ts`). An
 * agent wrote them, so these are what stand between an address and a frame
 * or a link: only web pages pass, and only Hive's own bytes are framed
 * without a sandbox.
 */
import { afterAll, beforeAll, describe, test, expect, vi } from "vitest";
import { addressParts, framablePdfAddress, webAddress } from "@/app/org/[githubLogin]/_components/artifacts/address";

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "https://hive.test" } });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("webAddress", () => {
  test("passes an http(s) address as it is", () => {
    expect(webAddress("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  });

  test("gives a bare host a scheme — http for this machine, https for anything else", () => {
    expect(webAddress("example.com")).toBe("https://example.com/");
    expect(webAddress("localhost:3000/w/mock")).toBe("http://localhost:3000/w/mock");
  });

  test("puts a path on Hive's own origin", () => {
    expect(webAddress("/w/mock")).toBe("https://hive.test/w/mock");
  });

  test("refuses anything that is not a web page", () => {
    expect(webAddress("javascript:alert(1)")).toBeNull();
    expect(webAddress("JaVaScRiPt://%0aalert(1)")).toBeNull();
    expect(webAddress("data:text/html,<p>hi</p>")).toBeNull();
    expect(webAddress("ftp://example.com")).toBeNull();
    expect(webAddress("   ")).toBeNull();
  });
});

describe("framablePdfAddress", () => {
  test("frames an address on Hive's own origin", () => {
    expect(framablePdfAddress("/api/files/brief.pdf")).toBe("https://hive.test/api/files/brief.pdf");
    expect(framablePdfAddress("https://hive.test/files/brief.pdf")).toBe("https://hive.test/files/brief.pdf");
  });

  test("frames bytes the page already holds", () => {
    expect(framablePdfAddress("blob:https://hive.test/1234")).toBe("blob:https://hive.test/1234");
    expect(framablePdfAddress("data:application/pdf;base64,AAAA")).toBe("data:application/pdf;base64,AAAA");
  });

  test("does not frame another site, another origin's blob, or anything that is not a PDF's bytes", () => {
    expect(framablePdfAddress("https://example.com/brief.pdf")).toBeNull();
    expect(framablePdfAddress("blob:https://evil.test/1234")).toBeNull();
    expect(framablePdfAddress("data:text/html,<p>hi</p>")).toBeNull();
    expect(framablePdfAddress("javascript:alert(1)")).toBeNull();
  });
});

describe("addressParts", () => {
  test("splits the host from the rest", () => {
    expect(addressParts("https://example.com/a/b?c=1#d")).toEqual({ host: "example.com", rest: "/a/b?c=1#d" });
  });

  test("a bare origin has no rest", () => {
    expect(addressParts("https://example.com/")).toEqual({ host: "example.com", rest: "" });
  });

  test("shows an address that is not a web page as it was written", () => {
    expect(addressParts("javascript:alert(1)")).toEqual({ host: "javascript:alert(1)", rest: "" });
  });
});
