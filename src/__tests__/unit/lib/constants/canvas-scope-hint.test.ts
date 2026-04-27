import { describe, it, expect } from "vitest";
import { getMultiWorkspacePrefixMessages } from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/workspaceConfig";

/**
 * Lock the contract that the canvas scope hint is:
 *   1. emitted into the system prompt only when `orgId` is set
 *      (otherwise canvas tools aren't loaded and the hint would be noise),
 *   2. names the current canvas ref so the agent defaults tool calls
 *      there, and
 *   3. includes the selected node id when one is provided.
 */

const makeWs = (slug: string): WorkspaceConfig =>
  ({
    slug,
    workspaceId: `ws-${slug}`,
    swarmUrl: "https://swarm.example",
    swarmApiKey: "k",
    repoUrls: [],
    pat: null,
    description: null,
    members: [],
    userId: "u",
  }) as unknown as WorkspaceConfig;

function systemContent(messages: ReturnType<typeof getMultiWorkspacePrefixMessages>): string {
  const sys = messages.find((m) => m.role === "system");
  if (!sys) throw new Error("expected a system message");
  return typeof sys.content === "string" ? sys.content : "";
}

describe("canvas scope hint in system prompt", () => {
  it("does NOT include the hint when orgId is absent", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      undefined,
      { currentCanvasRef: "initiative:abc", selectedNodeId: "ws:xyz" },
    );
    const sys = systemContent(messages);
    expect(sys).not.toContain("Current canvas scope");
  });

  it("does NOT include the hint when no scope info is provided", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
    );
    const sys = systemContent(messages);
    expect(sys).not.toContain("Current canvas scope");
  });

  it("describes the org root when ref is empty", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { currentCanvasRef: "" },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("Current canvas scope");
    expect(sys).toContain("the org root canvas");
    expect(sys).toContain('ref: ""');
  });

  it("names the sub-canvas ref when one is provided", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { currentCanvasRef: "initiative:abc" },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("`initiative:abc` sub-canvas");
    expect(sys).toContain('ref: "initiative:abc"');
  });

  it("mentions the selected node when provided", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { currentCanvasRef: "", selectedNodeId: "initiative:def" },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("`initiative:def`");
    expect(sys).toContain("this initiative/workspace/milestone");
  });

  it("emits hint when only selectedNodeId is set", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { selectedNodeId: "ws:zzz" },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("Current canvas scope");
    expect(sys).toContain("`ws:zzz`");
  });
});
