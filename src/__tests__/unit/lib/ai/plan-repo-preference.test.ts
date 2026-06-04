// @vitest-environment jsdom
import { describe, test, expect, afterEach } from "vitest";
import { getPlanRepoPreference, setPlanRepoPreference } from "@/lib/ai/models";

describe("getPlanRepoPreference / setPlanRepoPreference", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("returns null when window is undefined (SSR)", () => {
    const originalWindow = global.window;
    Object.defineProperty(global, "window", { value: undefined, writable: true, configurable: true });
    try {
      expect(getPlanRepoPreference("my-workspace")).toBeNull();
    } finally {
      Object.defineProperty(global, "window", { value: originalWindow, writable: true, configurable: true });
    }
  });

  test("setPlanRepoPreference does not throw when window is undefined (SSR)", () => {
    const originalWindow = global.window;
    Object.defineProperty(global, "window", { value: undefined, writable: true, configurable: true });
    try {
      expect(() => setPlanRepoPreference("my-workspace", ["repo-1"])).not.toThrow();
    } finally {
      Object.defineProperty(global, "window", { value: originalWindow, writable: true, configurable: true });
    }
  });

  test("returns null when no key stored for slug", () => {
    expect(getPlanRepoPreference("my-workspace")).toBeNull();
  });

  test("round-trips an array through localStorage keyed by slug", () => {
    setPlanRepoPreference("ws-a", ["id-1", "id-2"]);
    expect(getPlanRepoPreference("ws-a")).toEqual(["id-1", "id-2"]);
  });

  test("different slugs are stored independently", () => {
    setPlanRepoPreference("ws-a", ["id-1"]);
    setPlanRepoPreference("ws-b", ["id-2", "id-3"]);
    expect(getPlanRepoPreference("ws-a")).toEqual(["id-1"]);
    expect(getPlanRepoPreference("ws-b")).toEqual(["id-2", "id-3"]);
  });

  test("returns null when stored value is malformed JSON", () => {
    localStorage.setItem("plan_repo_preference_ws-x", "not-valid-json{{{");
    expect(getPlanRepoPreference("ws-x")).toBeNull();
  });
});
