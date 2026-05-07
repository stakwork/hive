import { describe, it, expect } from "vitest";
import { getMultiWorkspacePrefixMessages } from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/workspaceConfig";

/**
 * Lock the contract that the canvas scope hint is:
 *   1. emitted into the system prompt only when `orgId` is set
 *      (otherwise canvas tools aren't loaded and the hint would be noise),
 *   2. names the current canvas ref so the agent defaults tool calls
 *      there, and
 *   3. includes the selected node id when one is provided, and
 *   4. surfaces a human-readable breadcrumb (org name on root, parent ›
 *      child on a sub-canvas) so the agent can refer to the scope by
 *      name in replies instead of echoing an opaque ref id.
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

  it("includes the breadcrumb name on the root canvas", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { currentCanvasRef: "", currentCanvasBreadcrumb: "Acme" },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("**Acme**");
    expect(sys).toContain("the org root canvas");
    // The agent should be told to refer to the scope by name, not ref id.
    expect(sys).toContain('use the name "Acme"');
  });

  it("includes a parent › child breadcrumb on a sub-canvas", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      {
        currentCanvasRef: "initiative:abc",
        currentCanvasBreadcrumb: "Acme › Auth Refactor",
      },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("**Acme › Auth Refactor**");
    // Ref id is still surfaced for tool calls.
    expect(sys).toContain("`initiative:abc` sub-canvas");
    expect(sys).toContain('ref: "initiative:abc"');
    expect(sys).toContain('use the name "Acme › Auth Refactor"');
  });

  it("falls back to ref-only when no breadcrumb is provided", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { currentCanvasRef: "initiative:abc" },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("`initiative:abc` sub-canvas");
    // No name-based instruction when there's no name.
    expect(sys).not.toContain('use the name "');
  });

  // ─── Linked-workspace hint (initiative-scoped) ─────────────────────────────
  // The agent picks `workspaceId` for `propose_feature` itself; without
  // a DB-level Initiative→Workspace FK, only the root canvas's
  // `ws ↔ initiative` edge tells us which workspace a feature should
  // belong to. These tests lock the prompt-side surfacing of that hint.

  it("surfaces a single linked workspace as a strong directive", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      {
        currentCanvasRef: "initiative:abc",
        linkedWorkspaces: [
          { id: "ws-hive", slug: "hive", name: "Hive" },
        ],
      },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("**Hive**");
    expect(sys).toContain("slug `hive`");
    expect(sys).toContain("id `ws-hive`");
    expect(sys).toContain('workspaceId: "ws-hive"');
    expect(sys).toContain("propose_feature");
  });

  it("surfaces multiple linked workspaces as a list with an ask-the-user nudge", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      {
        currentCanvasRef: "initiative:abc",
        linkedWorkspaces: [
          { id: "ws-hive", slug: "hive", name: "Hive" },
          { id: "ws-sg", slug: "stakgraph", name: "Stakgraph" },
        ],
      },
    );
    const sys = systemContent(messages);
    expect(sys).toContain("**Hive**");
    expect(sys).toContain("**Stakgraph**");
    expect(sys).toContain("ask them before calling `propose_feature`");
  });

  it("does NOT surface the linked-workspace hint outside initiative scopes", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      {
        currentCanvasRef: "ws:zzz",
        // Non-initiative scope — even if linkedWorkspaces is set
        // somehow, the prompt branch should not fire.
        linkedWorkspaces: [
          { id: "ws-hive", slug: "hive", name: "Hive" },
        ],
      },
    );
    const sys = systemContent(messages);
    expect(sys).not.toContain("linked on the org root canvas");
    expect(sys).not.toContain('workspaceId: "ws-hive"');
  });

  it("omits the hint when linkedWorkspaces is empty/undefined on an initiative scope", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
      { currentCanvasRef: "initiative:abc" },
    );
    const sys = systemContent(messages);
    // Existing behaviour preserved — no linked-workspace section.
    expect(sys).not.toContain("linked on the org root canvas");
  });
});
