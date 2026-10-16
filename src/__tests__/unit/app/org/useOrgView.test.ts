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

import { canvasTab, canvasViewHref, useOrgView, viewIsFullBleed } from "@/app/org/[githubLogin]/_components/useOrgView";

beforeEach(() => {
  mockSearchParamsStore = {};
});

describe("useOrgView", () => {
  it.each(["settings", "workspaces", "members"])("maps /%s to settings", (seg) => {
    mockPathname = `/org/acme/${seg}`;
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("settings");
  });

  it("maps the strut path to the strut view", () => {
    mockPathname = "/org/acme/strut";
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("strut");
  });

  it("maps the base path to chats by default", () => {
    mockPathname = "/org/acme";
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("chats");
  });

  it("maps the base path with ?view=canvas to canvas", () => {
    mockPathname = "/org/acme";
    mockSearchParamsStore = { view: "canvas" };
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("canvas");
  });

  it("keeps older canvas-only links (?canvas=, ?r=) on the canvas", () => {
    mockPathname = "/org/acme";
    mockSearchParamsStore = { canvas: "initiative:abc" };
    expect(renderHook(() => useOrgView("acme")).result.current).toBe("canvas");
    mockSearchParamsStore = { r: "stripe-connect" };
    expect(renderHook(() => useOrgView("acme")).result.current).toBe("canvas");
  });

  it("lands the old control panel link on chats", () => {
    mockPathname = "/org/acme";
    mockSearchParamsStore = { view: "control-panel", chat: "c1" };
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("chats");
  });

  it("maps the base path with ?view=graph to graph", () => {
    mockPathname = "/org/acme";
    mockSearchParamsStore = { view: "graph" };
    const { result } = renderHook(() => useOrgView("acme"));
    expect(result.current).toBe("graph");
  });
});

describe("canvasViewHref", () => {
  it("switches to the canvas view keeping the open chat, applying the patch", () => {
    const href = canvasViewHref("/org/acme", new URLSearchParams("chat=c1&view=chats"), { r: "doc", canvas: "" });
    expect(href).toBe("/org/acme?chat=c1&view=canvas&r=doc");
  });
});

describe("viewIsFullBleed", () => {
  it("treats chats as full-bleed", () => {
    expect(viewIsFullBleed("chats")).toBe(true);
  });

  it("treats canvas and graph as full-bleed", () => {
    expect(viewIsFullBleed("canvas")).toBe(true);
    expect(viewIsFullBleed("graph")).toBe(true);
  });

  it("treats strut as full-bleed (unaffected)", () => {
    expect(viewIsFullBleed("strut")).toBe(true);
  });

  it("does not treat settings as full-bleed", () => {
    expect(viewIsFullBleed("settings")).toBe(false);
  });
});

describe("canvasTab", () => {
  it("defaults to map, initiatives only when asked", () => {
    expect(canvasTab(new URLSearchParams(""))).toBe("map");
    expect(canvasTab(new URLSearchParams("tab=other"))).toBe("map");
    expect(canvasTab(new URLSearchParams("tab=initiatives"))).toBe("initiatives");
    expect(canvasTab(null)).toBe("map");
  });
});
