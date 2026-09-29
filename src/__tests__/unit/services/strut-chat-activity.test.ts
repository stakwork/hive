/**
 * `services/strut-chat-activity` — reading a dispatched chat's workflows and
 * runs from its strut.
 *
 * Coverage:
 *   - Reads the chat from the resolved strut, with hive's swarm headers.
 *   - A run the transcript left `running` is asked about again; one that
 *     ended in the transcript is not.
 *   - Strut not answering for a run keeps the transcript's word.
 *   - No strut, an unreadable chat, or a throw → null, never a throw.
 */

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));

vi.mock("@/services/strut-target", () => ({ resolveStrutTarget: mockResolve }));
vi.mock("@/services/bifrost/strut-delegation", () => ({ STRUT_ACTOR_HEADER: "x-strut-actor" }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { readStrutChatActivity } from "@/services/strut-chat-activity";

const LAB = "https://swarm1.example.com:3355/lab";
const ARGS = { workspaceSlug: "acme", userId: "user-1", chatId: "chat-9" };

const transcript = [
  {
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: "c1", toolName: "create_workflow", input: { name: "digest" } },
      { type: "tool-call", toolCallId: "c2", toolName: "run_workflow", input: { name: "digest" } },
      { type: "tool-call", toolCallId: "c3", toolName: "run_workflow", input: { name: "digest" } },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "create_workflow",
        output: { type: "json", value: { ok: true, name: "digest", version: "v1" } },
      },
      {
        type: "tool-result",
        toolCallId: "c2",
        toolName: "run_workflow",
        output: { type: "json", value: { runId: "1", status: "error" } },
      },
      {
        type: "tool-result",
        toolCallId: "c3",
        toolName: "run_workflow",
        output: { type: "json", value: { runId: "2", status: "running", detached: true, workflow: "digest" } },
      },
    ],
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("readStrutChatActivity", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockResolve.mockResolvedValue({
      ok: true,
      target: { labBase: LAB, swarmApiKey: "swarm-key", actor: "evan-user-1" },
    });
    mockFetch.mockImplementation(async (url: string) =>
      url === `${LAB}/chat/chat-9`
        ? json({ meta: { id: "chat-9" }, messages: transcript })
        : json({ runId: "2", workflow: "digest", status: "success" }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  test("reads the chat, then asks again about the run it left running", async () => {
    expect(await readStrutChatActivity(ARGS)).toEqual({
      workflows: [{ name: "digest", version: "v1", action: "created" }],
      runs: [
        { workflow: "digest", runId: "1", status: "error" },
        { workflow: "digest", runId: "2", status: "success" },
      ],
    });

    expect(mockResolve).toHaveBeenCalledWith({ purpose: "chat", workspaceSlug: "acme", userId: "user-1" });
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([`${LAB}/chat/chat-9`, `${LAB}/workflows/digest/runs/2`]);
    for (const [, init] of mockFetch.mock.calls) {
      expect(init.headers).toMatchObject({ "x-api-token": "swarm-key", "x-strut-actor": "evan-user-1" });
    }
  });

  test("a run still in flight, or gone with a restart, says so", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes("/runs/")
        ? json({ runId: "2", workflow: "digest", partial: true, status: "paused" })
        : json({ messages: transcript }),
    );
    expect((await readStrutChatActivity(ARGS))?.runs[1].status).toBe("running");

    mockFetch.mockImplementation(async (url: string) =>
      url.includes("/runs/") ? json({ partial: true, status: "stale" }) : json({ messages: transcript }),
    );
    expect((await readStrutChatActivity(ARGS))?.runs[1].status).toBe("stale");
  });

  test("a run strut will not answer for keeps the transcript's word", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/runs/")) throw new Error("socket hang up");
      return json({ messages: transcript });
    });
    expect((await readStrutChatActivity(ARGS))?.runs[1]).toEqual({ workflow: "digest", runId: "2", status: "running" });

    mockFetch.mockImplementation(async (url: string) =>
      url.includes("/runs/") ? json({ error: "not found" }, 404) : json({ messages: transcript }),
    );
    expect((await readStrutChatActivity(ARGS))?.runs[1].status).toBe("running");
  });

  test("path segments are encoded", async () => {
    mockFetch.mockImplementation(async () => json({ messages: [] }));
    await readStrutChatActivity({ ...ARGS, chatId: "a/b ?c" });
    expect(mockFetch.mock.calls[0][0]).toBe(`${LAB}/chat/a%2Fb%20%3Fc`);
  });

  test("no strut, an unreadable chat, or a throw is null", async () => {
    mockResolve.mockResolvedValueOnce({ ok: false, error: { type: "NO_ORG_SWARM" } });
    expect(await readStrutChatActivity(ARGS)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockImplementation(async () => json({ error: "not found" }, 404));
    expect(await readStrutChatActivity(ARGS)).toBeNull();

    mockFetch.mockImplementation(async () => {
      throw new Error("timeout");
    });
    expect(await readStrutChatActivity(ARGS)).toBeNull();

    mockResolve.mockRejectedValueOnce(new Error("db down"));
    expect(await readStrutChatActivity(ARGS)).toBeNull();
  });
});
