import { vi } from "vitest";

type MockFn = ReturnType<typeof vi.fn>;

function createModelMock(register: (fn: MockFn) => void) {
  const store = new Map<PropertyKey, MockFn>();

  return new Proxy(
    {},
    {
      get(_target, prop: PropertyKey) {
        if (!store.has(prop)) {
          store.set(prop, register(vi.fn()));
        }

        return store.get(prop) as MockFn;
      },
      set(_target, prop: PropertyKey, value: unknown) {
        if (typeof value === "function") {
          const mock = value as MockFn;
          store.set(prop, mock);
          register(mock);
        }

        return true;
      },
      ownKeys() {
        return Array.from(store.keys());
      },
      getOwnPropertyDescriptor(_target, prop: PropertyKey) {
        const value = store.get(prop);

        if (!value) {
          return undefined;
        }

        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        };
      },
    },
  );
}

function createDbMock() {
  const mocks: MockFn[] = [];
  const register = (fn: MockFn) => {
    mocks.push(fn);
    return fn;
  };

  const model = () => createModelMock(register);

  const db = {
    workspace: model(),
    workspaceMember: model(),
    swarm: model(),
    gitHubAuth: model(),
    user: model(),
    account: model(),
    session: model(),
    sourceControlToken: model(),
    sourceControlOrg: model(),
    chatMessage: model(),
    task: model(),
    repository: model(),
    janitorRecommendation: model(),
    janitorRun: model(),
    janitorConfig: model(),
    artifact: model(),
    attachment: model(),
    product: model(),
  } satisfies Record<string, ReturnType<typeof model>>;

  const reset = () => {
    mocks.forEach((mock) => mock.mockReset());
  };

  return { db, reset };
}

const hoisted = vi.hoisted(() => createDbMock());

const { db: dbMock, reset } = hoisted;

vi.mock("@/lib/db", () => ({
  db: dbMock,
}));

export { dbMock };
export const resetDbMock = () => reset();
