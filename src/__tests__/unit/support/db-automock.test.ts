import { describe, it, expect, vi } from "vitest";
import { db } from "@/lib/db";

/**
 * A bare `vi.mock("@/lib/db")` must resolve to `src/lib/__mocks__/db.ts`.
 *
 * If that file goes away, Vitest falls back to automocking, which imports the
 * real module — and `@/lib/db` constructs a `PrismaClient` at import time.
 * The Rust query engine then initialises inside a Vitest worker thread, where
 * it intermittently panics and aborts the worker, failing whichever unrelated
 * test file happened to be running ("Aborted (core dumped)").
 */
vi.mock("@/lib/db");

describe("bare vi.mock('@/lib/db')", () => {
  it("resolves to the manual mock, not a real client", () => {
    // The manual mock materialises a spy for any model/method on first touch;
    // a real (or automocked) client has no such model.
    const anyModel = (db as unknown as Record<string, Record<string, unknown>>)
      .modelThatDoesNotExist;
    expect(anyModel).toBeDefined();
    expect(vi.isMockFunction(anyModel.methodThatDoesNotExist)).toBe(true);
  });

  it("keeps one client across vi.resetModules()", async () => {
    // Files that re-import a route after resetting modules rely on this: the
    // route must bind to the same mock the test stubbed.
    const before = (await import("@/lib/db")).db;
    vi.resetModules();
    const after = (await import("@/lib/db")).db;
    expect(after).toBe(before);
  });

  it("runs the callback passed to $transaction", async () => {
    // Automocking left the real implementation in place here, and routes under
    // test depend on the callback actually running.
    const tx = db as unknown as {
      $transaction: (cb: (client: unknown) => unknown) => Promise<unknown>;
    };
    await expect(tx.$transaction(async () => "ran")).resolves.toBe("ran");
  });
});
