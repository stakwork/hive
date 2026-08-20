/**
 * Manual mock for `@/lib/db`, picked up automatically by a bare
 * `vi.mock("@/lib/db")` in any unit test.
 *
 * Without this file that bare call falls back to Vitest's automocker, which
 * imports the real module to discover its shape — and `@/lib/db` constructs a
 * `PrismaClient` at import time. That spins up the Rust Node-API query engine
 * inside a Vitest worker thread, where it intermittently dies with:
 *
 *     thread '<unnamed>' panicked at query-engine-node-api/src/engine.rs
 *     Failed to deserialize constructor options.
 *     fatal runtime error: failed to initiate panic, error 5, aborting
 *
 * The abort takes the whole worker with it, so an unrelated test file fails CI
 * with "Aborted (core dumped)" after its own tests have already passed.
 *
 * This is a lazy proxy rather than a re-export of the fixed-model mock in
 * `@/__tests__/support/mocks/prisma` (which the unit setup file installs for
 * everyone else): callers of the bare form rely on automock's every-model,
 * every-method shape, including assigning over a method on a model the shared
 * mock never enumerated (`db.workflowVersion.findUnique = vi.fn()`).
 *
 * Semantics follow what the automocker actually produced, which was measured
 * rather than assumed: model methods are spies the test overwrites, but
 * `$transaction` stayed FUNCTIONAL — automocking left the real client's
 * implementation in place, so `db.$transaction(cb)` ran `cb`. Several of these
 * files depend on that (a bare spy silently skips the callback and the route
 * under test returns empty counts), so the default here runs the callback with
 * the mock client as the transaction handle and resolves the array form.
 */
import { vi } from "vitest";

type MockFn = ReturnType<typeof vi.fn>;

/**
 * Properties that must not resolve to a spy. `then` is the load-bearing one:
 * a thenable `db` would hijack any `await` on it and hang the caller.
 */
const NOT_A_SPY = new Set<PropertyKey>([
  "then",
  "catch",
  "finally",
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
  Symbol.toPrimitive,
]);

function lazyProxy(createValue: () => unknown) {
  const store = new Map<PropertyKey, unknown>();

  return new Proxy({} as Record<PropertyKey, unknown>, {
    get(_target, prop) {
      if (NOT_A_SPY.has(prop)) return undefined;
      if (!store.has(prop)) store.set(prop, createValue());
      return store.get(prop);
    },
    set(_target, prop, value) {
      store.set(prop, value);
      return true;
    },
    deleteProperty(_target, prop) {
      store.delete(prop);
      return true;
    },
    // Only report keys that have actually been touched, so the descriptor
    // trap below stays consistent with them (a proxy invariant).
    ownKeys() {
      return Array.from(store.keys()) as Array<string | symbol>;
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (!store.has(prop)) return undefined;
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: store.get(prop),
      };
    },
  });
}

/** A model delegate — `findUnique`, `create`, `count`, … all spies. */
const modelDelegate = () => lazyProxy(() => vi.fn() as MockFn);

/**
 * Client root: `$`-prefixed members (`$transaction`, `$queryRaw`, `$connect`,
 * …) are spies; everything else is a model delegate.
 *
 * Cached on `globalThis`, mirroring the real module's `globalForPrisma`
 * singleton. This is load-bearing: several of these files call
 * `vi.resetModules()` and then re-import the route under test. That
 * re-evaluates this module too, and without the cache the route would bind to
 * a fresh mock while the test still held the old one — every stubbed query
 * returns undefined and the route 404s. Under the automocker the real
 * module's own global cache is what made the pattern work.
 */
const globalForDbMock = globalThis as typeof globalThis & {
  __hiveDbMock__?: Record<PropertyKey, unknown>;
};

function createDbMock() {
  const client = lazyProxy(() => modelDelegate()) as Record<
    PropertyKey,
    unknown
  >;

  for (const clientMethod of [
    "$connect",
    "$disconnect",
    "$queryRaw",
    "$queryRawUnsafe",
    "$executeRaw",
    "$executeRawUnsafe",
    "$on",
    "$use",
    "$extends",
  ]) {
    client[clientMethod] = vi.fn() as MockFn;
  }

  client.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => unknown)(client)
      : await Promise.all((arg as unknown[]) ?? []),
  ) as MockFn;

  return client;
}

export const db = (globalForDbMock.__hiveDbMock__ ??= createDbMock());
