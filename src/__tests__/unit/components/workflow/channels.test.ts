// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock @anycable/web before any channel import ──────────────────────────────
//
// The shapes here must mirror @anycable/core's ActionCable compat layer, or the
// suite green-lights calls that throw in the browser:
//   • subscriptions.create() returns an ActionCableSubscription, whose teardown
//     is unsubscribe(). It has NO disconnect() — that lives on the Channel it
//     wraps, and on the consumer.
//   • createConsumer() returns an ActionCableConsumer, which DOES have
//     disconnect() (closes the socket).
const mockUnsubscribe = vi.fn();
const mockCableDisconnect = vi.fn();
const mockCreate = vi.fn(() => ({ unsubscribe: mockUnsubscribe }));
const mockCreateConsumer = vi.fn(() => ({
  subscriptions: { create: mockCreate },
  disconnect: mockCableDisconnect,
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
    disconnect: mockCableDisconnect,
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
  it("unsubscribes the subscription and closes the socket when unsubscribe() is invoked", () => {
    const channel = new WorkflowTransition("production", "proj-1", vi.fn());
    channel.subscribe();
    channel.unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockCableDisconnect).toHaveBeenCalledTimes(1);
  });

  it("only calls methods that exist on the real anycable subscription", () => {
    const channel = new WorkflowTransition("production", "proj-1", vi.fn());
    channel.subscribe();
    // The mock deliberately omits disconnect(); calling it would throw here
    // exactly as it did in the browser.
    expect(() => channel.unsubscribe()).not.toThrow();
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
  it("unsubscribes the subscription and closes the socket when unsubscribe() is invoked", () => {
    const edit = new WorkflowEdit("production", "wf-1", vi.fn());
    edit.subscribe();
    edit.unsubscribe();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockCableDisconnect).toHaveBeenCalledTimes(1);
  });

  it("does not throw when unsubscribe() is called before subscribe()", () => {
    const edit = new WorkflowEdit("production", "wf-1", vi.fn());
    expect(() => edit.unsubscribe()).not.toThrow();
  });

  it("only calls methods that exist on the real anycable subscription", () => {
    const edit = new WorkflowEdit("production", "wf-1", vi.fn());
    edit.subscribe();
    // Regression guard: unsubscribe() used to call channel.disconnect(), which
    // does not exist on an ActionCableSubscription. Thrown from the unmount
    // cleanup, that took down the whole React tree.
    expect(() => edit.unsubscribe()).not.toThrow();
  });
});
