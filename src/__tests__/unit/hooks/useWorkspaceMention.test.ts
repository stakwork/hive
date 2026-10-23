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
