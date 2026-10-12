/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

let mockPathname = "/org/acme";
let mockSearchParamsStore: Record<string, string> = {};

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsStore[key] ?? null,
  }),
}));

import { useOrgView, viewIsFullBleed } from "@/app/org/[githubLogin]/_components/useOrgView";

beforeEach(() => {
  mockSearchParamsStore = {};
});

describe("useOrgView", () => {
  it("maps the advisor path to the advisor view", () => {
    mockPathname = "/org/acme/advisor";
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("advisor");
  });

  it("maps the strut path to the strut view (unaffected by advisor addition)", () => {
    mockPathname = "/org/acme/strut";
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("strut");
  });

  it("maps the base path to canvas by default", () => {
    mockPathname = "/org/acme";
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("canvas");
  });

  it("maps the base path with ?view=graph to graph", () => {
    mockPathname = "/org/acme";
    mockSearchParamsStore = { view: "graph" };
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("graph");
  });
});

describe("viewIsFullBleed", () => {
  it("treats advisor as full-bleed", () => {
    expect(viewIsFullBleed("advisor")).toBe(true);
  });

  it("treats strut as full-bleed (unaffected)", () => {
    expect(viewIsFullBleed("strut")).toBe(true);
  });

  it("does not treat settings as full-bleed", () => {
    expect(viewIsFullBleed("settings")).toBe(false);
  });
});
