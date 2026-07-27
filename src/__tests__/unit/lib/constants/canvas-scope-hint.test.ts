import { describe, it, expect } from "vitest";
import {
  buildCanvasScopeMessage,
  getMultiWorkspacePrefixMessages,
} from "@/lib/constants/prompt";
import type { CanvasScopeHint } from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/workspaceConfig";

/**
 * Lock the contract that the canvas scope hint is:
 *   1. rendered into a TRAILING `<canvas-scope>` message — never inlined
 *      into the system prompt, which must stay byte-stable turn-to-turn
 *      so Anthropic prompt caching survives the user clicking around the
 *      canvas (see `CANVAS_SCOPE_POINTER`),
 *   2. omitted entirely when there's no scope to describe,
 *   3. names the current canvas ref so the agent defaults tool calls
 *      there, and
 *   4. includes the selected node id when one is provided, and
 *   5. surfaces a human-readable breadcrumb (org name on root, parent ›
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

/** The rendered `<canvas-scope>` block, or "" when none was emitted. */
function scopeBlock(scope?: CanvasScopeHint): string {
  const msg = buildCanvasScopeMessage(scope);
  if (!msg) return "";
  return typeof msg.content === "string" ? msg.content : "";
}

// ─── The system prompt must NOT carry volatile scope data ────────────────────
// This is the cache contract: the scope changes on every canvas click, and
// the system message is a single content block. Inlining the hint there
// invalidated the persona preamble + every capability snippet above it.

describe("system prompt stays scope-free (prompt-cache contract)", () => {
  it("carries only the static pointer, never the rendered scope", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
    );
    const sys = systemContent(messages);
    // Static pointer telling the agent where to look.
    expect(sys).toContain("<canvas-scope>");
    expect(sys).toContain("Current canvas scope");
    // …but none of the per-turn-volatile rendered values. (`initiative:`
    // on its own is fine — the capability snippets document the node-id
    // format; what must never appear is the rendered scope text.)
    expect(sys).not.toContain("They have selected node");
    expect(sys).not.toContain("They have selected 1 nodes");
    expect(sys).not.toContain("The user is viewing");
    expect(sys).not.toContain("linked on the org root canvas");
  });

  it("is byte-identical regardless of the user's canvas position", () => {
    const build = () =>
      systemContent(
        getMultiWorkspacePrefixMessages(
          [makeWs("alpha"), makeWs("beta")],
          { alpha: [], beta: [] },
          [],
          "org-1",
        ),
      );
    expect(build()).toBe(build());
  });

  it("omits the pointer entirely when orgId is absent (no canvas tools)", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      undefined,
    );
    expect(systemContent(messages)).not.toContain("<canvas-scope>");
  });
});

describe("canvas scope message", () => {
  it("emits no message when no scope is provided", () => {
    expect(buildCanvasScopeMessage(undefined)).toBeNull();
  });

  it("emits no message when the scope has no usable fields", () => {
    expect(buildCanvasScopeMessage({})).toBeNull();
  });

  it("is a user-role message wrapped in a <canvas-scope> tag", () => {
    const msg = buildCanvasScopeMessage({ currentCanvasRef: "" });
    expect(msg).not.toBeNull();
    expect(msg!.role).toBe("user");
    const content = typeof msg!.content === "string" ? msg!.content : "";
    expect(content.startsWith("<canvas-scope>")).toBe(true);
    expect(content.trimEnd().endsWith("</canvas-scope>")).toBe(true);
    // The agent must not mistake it for something the human typed.
    expect(content).toContain("the user did not type this");
  });

  it("describes the org root when ref is empty", () => {
    const block = scopeBlock({ currentCanvasRef: "" });
    expect(block).toContain("Current canvas scope");
    expect(block).toContain("the org root canvas");
    expect(block).toContain('ref: ""');
  });

  it("names the sub-canvas ref when one is provided", () => {
    const block = scopeBlock({ currentCanvasRef: "initiative:abc" });
    expect(block).toContain("`initiative:abc` sub-canvas");
    expect(block).toContain('ref: "initiative:abc"');
  });

  it("mentions the selected node when provided", () => {
    const block = scopeBlock({
      currentCanvasRef: "",
      selectedNodeId: "initiative:def",
    });
    expect(block).toContain("`initiative:def`");
    expect(block).toContain("this initiative/workspace/milestone");
  });

  it("emits the block when only selectedNodeId is set", () => {
    const block = scopeBlock({ selectedNodeId: "ws:zzz" });
    expect(block).toContain("Current canvas scope");
    expect(block).toContain("`ws:zzz`");
  });

  it("includes the breadcrumb name on the root canvas", () => {
    const block = scopeBlock({
      currentCanvasRef: "",
      currentCanvasBreadcrumb: "Acme",
    });
    expect(block).toContain("**Acme**");
    expect(block).toContain("the org root canvas");
    // The agent should be told to refer to the scope by name, not ref id.
    expect(block).toContain('use the name "Acme"');
  });

  it("includes a parent › child breadcrumb on a sub-canvas", () => {
    const block = scopeBlock({
      currentCanvasRef: "initiative:abc",
      currentCanvasBreadcrumb: "Acme › Auth Refactor",
    });
    expect(block).toContain("**Acme › Auth Refactor**");
    // Ref id is still surfaced for tool calls.
    expect(block).toContain("`initiative:abc` sub-canvas");
    expect(block).toContain('ref: "initiative:abc"');
    expect(block).toContain('use the name "Acme › Auth Refactor"');
  });

  it("falls back to ref-only when no breadcrumb is provided", () => {
    const block = scopeBlock({ currentCanvasRef: "initiative:abc" });
    expect(block).toContain("`initiative:abc` sub-canvas");
    // No name-based instruction when there's no name.
    expect(block).not.toContain('use the name "');
  });

  // ─── Linked-workspace hint (initiative-scoped) ─────────────────────────────
  // The agent picks `workspaceId` for `propose_feature` itself; without
  // a DB-level Initiative→Workspace FK, only the root canvas's
  // `ws ↔ initiative` edge tells us which workspace a feature should
  // belong to. These tests lock the prompt-side surfacing of that hint.

  it("surfaces a single linked workspace as a strong slug directive (no cuid)", () => {
    const block = scopeBlock({
      currentCanvasRef: "initiative:abc",
      linkedWorkspaces: [{ id: "ws-hive", slug: "hive", name: "Hive" }],
    });
    expect(block).toContain("**Hive**");
    expect(block).toContain("slug `hive`");
    expect(block).toContain('workspaceSlug: "hive"');
    expect(block).toContain("propose_feature");
    // The id must not leak into the prompt — that's the failure mode
    // we're protecting against. Tools resolve slug → id internally.
    expect(block).not.toContain("ws-hive");
    expect(block).not.toContain("workspaceId:");
  });

  it("surfaces multiple linked workspaces as a list with an ask-the-user nudge", () => {
    const block = scopeBlock({
      currentCanvasRef: "initiative:abc",
      linkedWorkspaces: [
        { id: "ws-hive", slug: "hive", name: "Hive" },
        { id: "ws-sg", slug: "stakgraph", name: "Stakgraph" },
      ],
    });
    expect(block).toContain("**Hive**");
    expect(block).toContain("**Stakgraph**");
    expect(block).toContain("ask them before calling `propose_feature`");
    // No cuids in the multi-linked branch either.
    expect(block).not.toContain("ws-hive");
    expect(block).not.toContain("ws-sg");
  });

  it("does NOT surface the linked-workspace hint outside initiative scopes", () => {
    const block = scopeBlock({
      currentCanvasRef: "ws:zzz",
      // Non-initiative scope — even if linkedWorkspaces is set
      // somehow, the prompt branch should not fire.
      linkedWorkspaces: [{ id: "ws-hive", slug: "hive", name: "Hive" }],
    });
    expect(block).not.toContain("linked on the org root canvas");
    expect(block).not.toContain('workspaceSlug: "hive"');
  });

  it("omits the hint when linkedWorkspaces is empty/undefined on an initiative scope", () => {
    const block = scopeBlock({ currentCanvasRef: "initiative:abc" });
    // Existing behaviour preserved — no linked-workspace section.
    expect(block).not.toContain("linked on the org root canvas");
  });
});

// ─── Brevity / no-id-leak rules in the system prompt ─────────────────────────
// These rules govern *how* the agent talks to the user. They sit at the
// top of the prompt so they don't get buried under the tool docs.

describe("reply style + no-id-leak rules", () => {
  it("includes explicit no-narration / no-filler / no-id-leak rules near the top", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
    );
    const sys = systemContent(messages);
    // Section header.
    expect(sys).toContain("Reply style");
    // No tool-call play-by-play.
    expect(sys.toLowerCase()).toContain("don't narrate tool calls");
    // No filler openers like "Perfect!" or "Let me check".
    expect(sys).toMatch(/Perfect!/);
    expect(sys).toMatch(/Let me check/);
    // No echoing internal ids.
    expect(sys).toMatch(/never echo internal ids/i);
  });

  it("does NOT list the cuid `id` for any workspace in the upfront list", () => {
    const messages = getMultiWorkspacePrefixMessages(
      [makeWs("alpha"), makeWs("beta")],
      { alpha: [], beta: [] },
      [],
      "org-1",
    );
    const sys = systemContent(messages);
    // The mock workspaces have id `ws-alpha` / `ws-beta`. Those must
    // not appear anywhere in the prompt — the agent only ever needs
    // the slug (tools resolve slug → id internally).
    expect(sys).not.toContain("ws-alpha");
    expect(sys).not.toContain("ws-beta");
    // Slug should still be there.
    expect(sys).toContain("slug: `alpha`");
    expect(sys).toContain("slug: `beta`");
    // No "id: `…`" annotation in the workspace list line.
    expect(sys).not.toMatch(/slug: `\w+`, id: `/);
  });
});
