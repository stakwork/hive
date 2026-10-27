import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCreateDispatch } = vi.hoisted(() => ({ mockCreateDispatch: vi.fn().mockResolvedValue({}) }));
vi.mock("livekit-server-sdk", () => ({
  AgentDispatchClient: vi.fn().mockImplementation(() => ({ createDispatch: mockCreateDispatch })),
}));
vi.mock("@/lib/redis", () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));

import { callTranscriptWanted, callTranscriptWorkflowName, dispatchCallAgent } from "@/lib/calls/callAgent";

describe("call transcript dispatch", () => {
  const saved = {
    wf: process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME,
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET,
  };
  const restore = (name: string, v: string | undefined) => {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "k";
    process.env.LIVEKIT_API_SECRET = "s";
  });
  afterEach(() => {
    restore("CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME", saved.wf);
    restore("LIVEKIT_URL", saved.url);
    restore("LIVEKIT_API_KEY", saved.key);
    restore("LIVEKIT_API_SECRET", saved.secret);
  });

  it("metadata carries transcript:true only when asked", async () => {
    await dispatchCallAgent("room", "key1");
    await dispatchCallAgent("room", "key1", { transcript: false });
    await dispatchCallAgent("room", "key1", { transcript: true });
    const meta = mockCreateDispatch.mock.calls.map((c) => JSON.parse(c[2].metadata));
    expect(meta).toEqual([{ callKey: "key1" }, { callKey: "key1" }, { callKey: "key1", transcript: true }]);
  });

  it("callTranscriptWorkflowName trims and nulls empty", () => {
    delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
    expect(callTranscriptWorkflowName()).toBeNull();
    process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = "   ";
    expect(callTranscriptWorkflowName()).toBeNull();
    process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = " wf ";
    expect(callTranscriptWorkflowName()).toBe("wf");
  });

  it("callTranscriptWanted truth table", () => {
    delete process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME;
    expect(callTranscriptWanted("org")).toBe(false);
    expect(callTranscriptWanted(null)).toBe(false);
    process.env.CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME = "wf";
    expect(callTranscriptWanted("org")).toBe(true);
    expect(callTranscriptWanted(null)).toBe(false);
    expect(callTranscriptWanted(undefined)).toBe(false);
    expect(callTranscriptWanted("")).toBe(false);
  });
});
