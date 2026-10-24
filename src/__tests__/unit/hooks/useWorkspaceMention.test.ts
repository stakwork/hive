import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  applyMention,
  detectMentionQuery,
  filterMentionWorkspaces,
  useWorkspaceMention,
} from "@/hooks/useWorkspaceMention";

const workspaces = [
  { slug: "alpha", name: "Alpha Team" },
  { slug: "beta", name: "Billing" },
  { slug: "self", name: "Self" },
];

const key = (k: string, extra: object = {}) =>
  ({ key: k, shiftKey: false, preventDefault: vi.fn(), ...extra }) as unknown as React.KeyboardEvent<HTMLTextAreaElement>;

describe("mention helpers", () => {
  it("detects the query before the caret", () => {
    expect(detectMentionQuery("hi @al", 6)).toBe("al");
    expect(detectMentionQuery("hi @", 4)).toBe("");
    expect(detectMentionQuery("a@b", 3)).toBeNull();
    expect(detectMentionQuery("hi @al there", 12)).toBeNull();
  });

  it("filters by slug or name and excludes slug", () => {
    expect(filterMentionWorkspaces(workspaces, "bill").map((w) => w.slug)).toEqual(["beta"]);
    expect(filterMentionWorkspaces(workspaces, "", "self").map((w) => w.slug)).toEqual(["alpha", "beta"]);
  });

  const slugs = (list: { slug: string }[]) => list.map((w) => w.slug);

  it("ranks @h with hive first and keeps the rest in input order", () => {
    const list = ["graphmindset", "sphinx-apps", "openhealth", "sphinx-android-v2", "hive", "sphinx-server"].map(
      (slug) => ({ slug, name: slug }),
    );
    expect(slugs(filterMentionWorkspaces(list, "h"))).toEqual([
      "hive",
      "sphinx-server",
      "sphinx-apps",
      "sphinx-android-v2",
      "graphmindset",
      "openhealth",
    ]);
  });

  it("orders each rank tier", () => {
    const list = [
      { slug: "xxappxx", name: "Nothing" }, // 4 slug contains
      { slug: "zzz", name: "Has app inside" }, // 3 name word prefix
      { slug: "yy", name: "Mapp" }, // 5 name contains
      { slug: "my-app", name: "My" }, // 3 slug word prefix
      { slug: "application", name: "X" }, // 2 slug prefix
      { slug: "app", name: "X" }, // 1 exact
    ];
    expect(slugs(filterMentionWorkspaces(list, "APP"))).toEqual([
      "app",
      "application",
      "zzz",
      "my-app",
      "xxappxx",
      "yy",
    ]);
  });

  it("name prefix ranks in tier 3 and exact beats prefix", () => {
    const list = [
      { slug: "apple", name: "A" },
      { slug: "zed", name: "App Zed" },
      { slug: "app", name: "B" },
    ];
    expect(slugs(filterMentionWorkspaces(list, "app"))).toEqual(["app", "apple", "zed"]);
  });

  it("keeps order for empty query, honors excludeSlug, and does not mutate", () => {
    const list = [
      { slug: "b", name: "B" },
      { slug: "a", name: "A" },
      { slug: "c", name: "C" },
    ];
    const copy = [...list];
    expect(slugs(filterMentionWorkspaces(list, ""))).toEqual(["b", "a", "c"]);
    expect(slugs(filterMentionWorkspaces(list, "", "a"))).toEqual(["b", "c"]);
    filterMentionWorkspaces(list, "a");
    expect(list).toEqual(copy);
  });

  it("replaces the query with the slug and a trailing space", () => {
    expect(applyMention("hi @al rest", 6, "alpha")).toEqual({ text: "hi @alpha  rest", caret: 10 });
    expect(applyMention("@", 1, "beta")).toEqual({ text: "@beta ", caret: 6 });
  });
});

describe("useWorkspaceMention", () => {
  it("opens on @, navigates, selects with Enter", () => {
    const onInsert = vi.fn();
    const { result } = renderHook(() => useWorkspaceMention({ workspaces, onInsert }));
    act(() => result.current.update("@", 1));
    expect(result.current.isOpen).toBe(true);
    act(() => void result.current.handleKeyDown(key("ArrowDown"), "@", 1));
    expect(result.current.activeIndex).toBe(1);
    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown(key("Enter"), "@", 1);
    });
    expect(handled).toBe(true);
    expect(onInsert).toHaveBeenCalledWith({ text: "@beta ", caret: 6 });
    expect(result.current.isOpen).toBe(false);
  });

  it("Tab selects, Escape closes, ArrowUp wraps", () => {
    const onInsert = vi.fn();
    const { result } = renderHook(() => useWorkspaceMention({ workspaces, onInsert }));
    act(() => result.current.update("@a", 2));
    act(() => void result.current.handleKeyDown(key("ArrowUp"), "@a", 2));
    expect(result.current.activeIndex).toBe(1); // wraps to last of 2 matches (alpha, beta)
    act(() => void result.current.handleKeyDown(key("ArrowDown"), "@a", 2));
    act(() => void result.current.handleKeyDown(key("Tab"), "@a", 2));
    expect(onInsert).toHaveBeenCalledWith({ text: "@alpha ", caret: 7 });
    act(() => result.current.update("@a", 2));
    act(() => void result.current.handleKeyDown(key("Escape"), "@a", 2));
    expect(result.current.isOpen).toBe(false);
  });

  it("ignores keys when closed and Shift+Enter when open", () => {
    const { result } = renderHook(() => useWorkspaceMention({ workspaces, onInsert: vi.fn() }));
    expect(result.current.handleKeyDown(key("Enter"), "x", 1)).toBe(false);
    act(() => result.current.update("@", 1));
    expect(result.current.handleKeyDown(key("Enter", { shiftKey: true }), "@", 1)).toBe(false);
  });
});
