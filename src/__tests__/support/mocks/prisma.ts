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

  const $transaction = register(vi.fn());
  const $queryRaw = register(vi.fn());
  const $executeRaw = register(vi.fn());

  const db = {
    workspaces: model(),
    workspace_members: model(),
    swarms: model(),
    github_auth: model(),
    users: model(),
    accounts: model(),
    sessions: model(),
    source_control_tokens: model(),
    source_control_orgs: model(),
    chat_messages: model(),
    tasks: model(),
    repositories: model(),
    janitor_recommendations: model(),
    janitor_runs: model(),
    janitor_configs: model(),
    artifacts: model(),
    attachments: model(),
    features: model(),
    phases: model(),
    whiteboards: model(),
    whiteboard_messages: model(),
    whiteboard_versions: model(),
    stakwork_runs: model(),
    agent_logs: model(),
    pods: model(),
    screenshots: model(),
    deployments: model(),
    notification_triggers: model(),
    diagrams: model(),
    diagram_workspaces: model(),
    shared_conversations: model(),
    workspace_api_keys: model(),
    user_stories: model(),
    environment_variables: model(),
    $transaction,
    $queryRaw,
    $executeRaw,
  } satisfies Record<string, ReturnType<typeof model> | MockFn>;

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
