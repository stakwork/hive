/**
 * `lib/strut-chat-activity` — the workflows and runs of a strut chat, read
 * off its transcript.
 *
 * The transcript fixtures are the shapes strut stores (`messages.jsonl`):
 * a tool call is an assistant part, its result a `tool` part carrying
 * `{ type: "json", value }`.
 */

// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  MAX_STRUT_CHAT_RUNS,
  parseStrutChatActivity,
  projectStrutChatActivity,
  toStrutChatRunStatus,
} from "@/lib/strut-chat-activity";

let callSeq = 0;

/** One tool call and its result, as the two transcript messages strut stores. */
function toolTurn(toolName: string, input: unknown, value: unknown, outputType = "json") {
  const toolCallId = `call-${++callSeq}`;
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: "On it." },
        { type: "tool-call", toolCallId, toolName, input },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", toolCallId, toolName, output: { type: outputType, value } }] },
  ];
}

const created = (name: string, version = "v1") =>
  toolTurn("create_workflow", { name, yaml: "name: x" }, { ok: true, name, version, renamed: false, requested: name });
const edited = (name: string, version: string, changed = true) =>
  toolTurn("edit_workflow", { name, yaml: "name: x" }, { ok: true, name, version, changed });
const ran = (name: string, runId: string, status: string, extra: Record<string, unknown> = {}) =>
  toolTurn("run_workflow", { name, input: {} }, { runId, status, ...extra });

describe("projectStrutChatActivity", () => {
  test("a chat that built, ran and revised one workflow", () => {
    const activity = projectStrutChatActivity([
      { role: "user", content: "Build a clipper" },
      ...created("youtube-clip"),
      ...ran("youtube-clip", "1789585940643", "error", { error: { message: "yt-dlp exited with 1" } }),
      ...edited("youtube-clip", "v2"),
      ...ran("youtube-clip", "1789586040109", "success", { output: { clip: "/artifacts/1/clip.mp4" } }),
    ]);
    expect(activity).toEqual({
      // Created here, so it stays `created` however often it was edited after.
      workflows: [{ name: "youtube-clip", version: "v2", action: "created" }],
      runs: [
        { workflow: "youtube-clip", runId: "1789585940643", status: "error" },
        { workflow: "youtube-clip", runId: "1789586040109", status: "success" },
      ],
    });
  });

  test("a workflow that existed before the chat is `edited`", () => {
    expect(projectStrutChatActivity(edited("digest", "v7")).workflows).toEqual([
      { name: "digest", version: "v7", action: "edited" },
    ]);
  });

  test("a detached run is running, named by the result when the call did not", () => {
    const detached = toolTurn(
      "run_workflow",
      {},
      { status: "running", detached: true, runId: "42", workflow: "digest", note: "continues detached" },
    );
    expect(projectStrutChatActivity(detached).runs).toEqual([{ workflow: "digest", runId: "42", status: "running" }]);
  });

  test("what published or launched nothing is left out", () => {
    const activity = projectStrutChatActivity([
      // Validation refused it; an identical edit; a workflow that does not exist; a tool that threw.
      ...toolTurn("create_workflow", { name: "bad" }, { error: "step `x` has no type", validation: { ok: false } }),
      ...edited("digest", "v7", false),
      ...toolTurn("run_workflow", { name: "ghost" }, { ok: false, error: "Workflow not found" }),
      ...toolTurn("run_workflow", { name: "digest" }, "boom", "error-text"),
      // Other tools, however workflow-shaped their results.
      ...toolTurn("get_workflow", { name: "digest" }, { ok: true, name: "digest", version: "v7" }),
      ...toolTurn("get_run", { name: "digest" }, { runId: "9", status: "success" }),
    ]);
    expect(activity).toEqual({ workflows: [], runs: [] });
  });

  test("create_workflow reports the FINAL name when strut renamed on collision", () => {
    const renamed = toolTurn(
      "create_workflow",
      { name: "send-email" },
      { ok: true, name: "send-email-2", version: "v1", renamed: true, requested: "send-email" },
    );
    expect(projectStrutChatActivity(renamed).workflows).toEqual([
      { name: "send-email-2", version: "v1", action: "created" },
    ]);
  });

  test("keeps the newest runs, and orders workflows by their latest touch", () => {
    const many = Array.from({ length: MAX_STRUT_CHAT_RUNS + 3 }, (_, i) => ran("digest", `run-${i}`, "success")).flat();
    const { runs } = projectStrutChatActivity(many);
    expect(runs).toHaveLength(MAX_STRUT_CHAT_RUNS);
    expect(runs[0].runId).toBe("run-3");
    expect(runs.at(-1)?.runId).toBe(`run-${MAX_STRUT_CHAT_RUNS + 2}`);

    const { workflows } = projectStrutChatActivity([...created("a"), ...created("b"), ...edited("a", "v2")]);
    expect(workflows.map((w) => w.name)).toEqual(["b", "a"]);
  });

  test("keeps names and ids only, and only sane ones", () => {
    const activity = projectStrutChatActivity([
      ...ran("digest", "7", "success", { output: { secret: "sk-live-1" } }),
      ...created("x".repeat(500)),
      ...ran("digest", "y".repeat(500), "success"),
      ...toolTurn("run_workflow", { name: "digest" }, { runId: 12, status: "success" }),
    ]);
    expect(activity).toEqual({ workflows: [], runs: [{ workflow: "digest", runId: "7", status: "success" }] });
    expect(JSON.stringify(activity)).not.toContain("sk-live-1");
  });

  test("anything that is not a transcript is an empty activity", () => {
    for (const junk of [undefined, null, "text", {}, [null, 3, { role: "assistant" }, { content: [null, "x"] }]]) {
      expect(projectStrutChatActivity(junk)).toEqual({ workflows: [], runs: [] });
    }
  });
});

describe("toStrutChatRunStatus", () => {
  test("a live run's controller states are all still in flight", () => {
    for (const s of ["running", "pausing", "paused", "cancelling"]) expect(toStrutChatRunStatus(s)).toBe("running");
  });

  test("finished and stale pass through; the unknown reads as the fallback", () => {
    for (const s of ["success", "error", "cancelled", "stale"]) expect(toStrutChatRunStatus(s)).toBe(s);
    expect(toStrutChatRunStatus("weird")).toBe("running");
    expect(toStrutChatRunStatus(undefined, "success")).toBe("success");
  });
});

describe("parseStrutChatActivity", () => {
  test("reads back what the projection wrote", () => {
    const activity = projectStrutChatActivity([...created("clipper"), ...ran("clipper", "17", "running")]);
    expect(parseStrutChatActivity(JSON.parse(JSON.stringify(activity)))).toEqual(activity);
  });

  test("drops what is malformed; null when there is nothing to read", () => {
    expect(parseStrutChatActivity(null)).toBeNull();
    expect(parseStrutChatActivity("x")).toBeNull();
    expect(
      parseStrutChatActivity({
        workflows: [{ name: "ok", action: "renamed", version: 3 }, { name: 7 }, null],
        runs: [{ workflow: "ok", runId: "1", status: "exploded" }, { workflow: "ok" }, "x"],
      }),
    ).toEqual({
      workflows: [{ name: "ok", action: "edited" }],
      runs: [{ workflow: "ok", runId: "1", status: "running" }],
    });
  });
});
