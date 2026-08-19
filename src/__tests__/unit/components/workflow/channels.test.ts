// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock @anycable/web before any channel import ──────────────────────────────
const mockDisconnect = vi.fn();
const mockCreate = vi.fn(() => ({ disconnect: mockDisconnect }));
const mockCreateConsumer = vi.fn(() => ({
  subscriptions: { create: mockCreate },
}));

vi.mock("@anycable/web", () => ({
  createConsumer: (...args: unknown[]) => mockCreateConsumer(...args),
}));

// ── import channels AFTER the mock is registered ─────────────────────────────
import WorkflowTransition from "@/components/workflow/channels/WorkflowTransition";
import WorkflowEdit from "@/components/workflow/channels/WorkflowEdit";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the mock factory so each test gets a fresh consumer object
  mockCreateConsumer.mockImplementation(() => ({
    subscriptions: { create: mockCreate },
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowTransition — createConsumer called with resolved URL
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkflowTransition — createConsumer URL", () => {
  it("passes the production cable URL when railsEnv is 'production'", () => {
    new WorkflowTransition("production", "proj-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://jobs.stakwork.com/cable"
    );
  });

  it("passes the staging cable URL when railsEnv is 'staging'", () => {
    new WorkflowTransition("staging", "proj-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://staging.stakwork.com/cable"
    );
  });

  it("passes the staging cable URL when railsEnv is 'development'", () => {
    new WorkflowTransition("development", "proj-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://staging.stakwork.com/cable"
    );
  });

  it("passes the staging cable URL for near-miss value 'prod'", () => {
    new WorkflowTransition("prod", "proj-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://staging.stakwork.com/cable"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowTransition — unsubscribe teardown
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkflowTransition — unsubscribe teardown", () => {
  it("calls disconnect on the subscription channel when unsubscribe() is invoked", () => {
    const channel = new WorkflowTransition("production", "proj-1", vi.fn());
    channel.subscribe();
    channel.unsubscribe();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEdit — createConsumer called with resolved URL
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkflowEdit — createConsumer URL", () => {
  it("passes the production cable URL when railsEnv is 'production'", () => {
    new WorkflowEdit("production", "wf-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://jobs.stakwork.com/cable"
    );
  });

  it("passes the staging cable URL when railsEnv is 'staging'", () => {
    new WorkflowEdit("staging", "wf-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://staging.stakwork.com/cable"
    );
  });

  it("passes the staging cable URL for near-miss value 'prod'", () => {
    new WorkflowEdit("prod", "wf-1", vi.fn());
    expect(mockCreateConsumer).toHaveBeenCalledWith(
      "wss://staging.stakwork.com/cable"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEdit — unsubscribe teardown (method added in this fix)
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkflowEdit — unsubscribe teardown", () => {
  it("calls disconnect on the subscription channel when unsubscribe() is invoked", () => {
    const edit = new WorkflowEdit("production", "wf-1", vi.fn());
    edit.subscribe();
    edit.unsubscribe();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("does not throw when unsubscribe() is called before subscribe()", () => {
    const edit = new WorkflowEdit("production", "wf-1", vi.fn());
    expect(() => edit.unsubscribe()).not.toThrow();
  });
});
