import { describe, it, expect } from "vitest";
import {
  getMultiWorkspaceSystemPrompt,
  getRoadmapCapabilitySnippet,
  getGraphWalkerCapabilitySnippet,
  getConceptsCapabilitySnippet,
} from "@/lib/constants/prompt";
import {
  getSlimRoadmapCapabilitySnippet,
  getSlimGraphWalkerCapabilitySnippet,
  getSlimConceptsCapabilitySnippet,
} from "@/lib/constants/prompt-slim";
import {
  GITHUB_ORG_RULE,
} from "@/lib/constants/prompt-rules";
import { composeCapabilityPromptSuffix } from "@/lib/ai/capabilities";
import type { WorkspaceConfig } from "@/lib/ai/types";

/**
 * Jamie slim prompt (concept-tree mode, opt-in via the per-browser settings switch)
 * — asserts the toggle selects the right text, the slim prompt carries a
 * no concept-tree entry of its own (that lives in the Prompt Manager
 * prompt `CANVAS_AGENT_SYSTEM_PROMPT`) and no hardcoded concept names, every
 * seed-list safety rule still has a string that keeps it alive, and no
 * removed vocabulary (admin-only, placement verbs, a core-capability
 * `learn_capability` call) survives in the slim prompt.
 *
 * `KEPT_SAFETY_STRINGS` below is the audit table from
 * `docs/jamie-prompt-slim/concepts.md` §2 — one string per seed-list
 * rule, plus graph-write rules and "never construct URNs by hand".
 */

function makeWs(slug: string): WorkspaceConfig {
  return {
    slug,
    name: `Workspace ${slug}`,
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `ws-${slug}`,
    userId: "user-1",
    members: [],
  } as unknown as WorkspaceConfig;
}

const CORE_CAPABILITIES = ["roadmap", "graph_walker", "concepts"] as const;

const ALL_CAPABILITY_TEXT = () =>
  getSlimRoadmapCapabilitySnippet() +
  getSlimGraphWalkerCapabilitySnippet() +
  getSlimConceptsCapabilitySnippet();

describe("Jamie slim prompt — toggle", () => {
  it("off: the suffix uses the full core snippets", () => {
    const suffix = composeCapabilityPromptSuffix([...CORE_CAPABILITIES]);
    expect(suffix).toContain(getRoadmapCapabilitySnippet());
    expect(suffix).toContain(getGraphWalkerCapabilitySnippet());
    expect(suffix).toContain(getConceptsCapabilitySnippet());
  });

  it("on: the suffix uses the slim core snippets", () => {
    const suffix = composeCapabilityPromptSuffix([...CORE_CAPABILITIES], {
      slimPrompt: true,
    });
    expect(suffix).toContain(getSlimRoadmapCapabilitySnippet());
    expect(suffix).toContain(getSlimGraphWalkerCapabilitySnippet());
    expect(suffix).toContain(getSlimConceptsCapabilitySnippet());
    expect(suffix).not.toContain(getRoadmapCapabilitySnippet());
  });

  it("neither mode adds its own concept-tree entry (the system prompt owns it)", () => {
    for (const slimPrompt of [false, true]) {
      const suffix = composeCapabilityPromptSuffix([...CORE_CAPABILITIES], {
        slimPrompt,
      });
      expect(suffix).not.toContain("walk your concept tree");
      expect(suffix).not.toContain("Glimmer");
    }
  });

});

describe("Jamie slim prompt — no hardcoded concepts", () => {
  it("names no concept from the tree — the rest is walked", () => {
    const text = ALL_CAPABILITY_TEXT();
    for (const name of [
      "Hive Roadmap and Canvas",
      "Jamie Roadmap Proposals",
      "The Knowledge Graph on Stadeum",
      "Jamie Knowledge Capture",
    ]) {
      expect(text).not.toContain(name);
    }
  });
});

describe("Jamie slim prompt — kept safety strings (seed-list audit)", () => {
  // Strings that live in the code-built prompt (prompt.ts) itself.
  const KEPT_SAFETY_STRINGS_PROMPT: string[] = [
    // 1. Propose, don't write.
    "You are not a coding agent.",
    "**Propose, don't write.**",
    // 2. repo_agent is read-only.
    "STRICTLY READ-ONLY investigation",
    // 4. graph_query is member-scoped, not admin-only
    "any member of the named workspace",
    // 6. Never construct URNs by hand
    "Never construct URN strings by hand",
    // 7. Mirror-owned types are not editable
    "Mirror-owned types are not editable.",
    // 9. GitHub org is not a workspace
    GITHUB_ORG_RULE,
  ];

  it("every kept safety string is present somewhere in the prompt + tool text", () => {
    const promptText =
      getMultiWorkspaceSystemPrompt([makeWs("alpha")]) + ALL_CAPABILITY_TEXT();
    for (const needle of KEPT_SAFETY_STRINGS_PROMPT) {
      expect(promptText, `expected to find: ${needle}`).toContain(needle);
    }
  });

});

describe("Jamie slim prompt — must-stay lines", () => {
  it("keeps the don't-know reply line verbatim", () => {
    expect(getMultiWorkspaceSystemPrompt([makeWs("alpha")])).toContain(
      'If you really can\'t find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don\'t know the answer to that question, I\'ll look into it."',
    );
  });

  it("keeps the roadmap→code chain line", () => {
    expect(getGraphWalkerCapabilitySnippet()).toContain(
      "HiveFeature  --HAS_TASK-->  HiveTask  --RESULTED_IN-->  PullRequest  -->  File",
    );
  });

  it("keeps the GITHUB_ORG_RULE in the workspace guidance", () => {
    expect(getMultiWorkspaceSystemPrompt([makeWs("alpha")])).toContain(
      GITHUB_ORG_RULE,
    );
  });
});

describe("Jamie slim prompt — removed vocabulary", () => {
  it("no 'admin-only' claim anywhere in the prompt or capability text", () => {
    expect(ALL_CAPABILITY_TEXT()).not.toContain("admin-only");
    expect(getGraphWalkerCapabilitySnippet()).not.toContain("admin-only");
    expect(getMultiWorkspaceSystemPrompt([makeWs("alpha")])).not.toContain(
      "admin-only",
    );
  });

  it("no placement vocabulary left in the prompt (moved to initiativeTools.ts)", () => {
    const text = getSlimRoadmapCapabilitySnippet();
    expect(text).not.toMatch(/`near:<liveId>`/);
    expect(text).not.toMatch(/`right-of:<liveId>`/);
    expect(text).not.toMatch(/`left-of:<liveId>`/);
  });
});

describe("Jamie slim prompt — tool text carries moved rules", () => {
  it("REF_DESCRIPTION (canvasTools) has ws: and initiative: but not the four projected id kinds; read_canvas has all four", async () => {
    const { buildCanvasTools } = await import("@/lib/ai/canvasTools");
    const tools = buildCanvasTools("org-1") as unknown as Record<
      string,
      {
        description: string;
        inputSchema: {
          shape: Record<string, { unwrap?: () => { description?: string } }>;
        };
      }
    >;
    const refField = tools.read_canvas.inputSchema.shape.ref;
    const refDesc = String(refField?.unwrap?.()?.description ?? "");
    expect(refDesc).toContain("ws:");
    expect(refDesc).toContain("initiative:");
    expect(refDesc).not.toContain("repo:<cuid>");
    expect(refDesc).not.toContain("milestone:<cuid>");
    expect(refDesc).not.toContain("feature:<cuid>");
    expect(refDesc).not.toContain("research:<cuid>");

    const readCanvasDesc = tools.read_canvas.description;
    expect(readCanvasDesc).toContain("repo:<cuid>");
    expect(readCanvasDesc).toContain("milestone:<cuid>");
    expect(readCanvasDesc).toContain("feature:<cuid>");
    expect(readCanvasDesc).toContain("research:<cuid>");
  });
});

describe("Jamie slim prompt — size cap", () => {
  it("the slim code-built prompt (system + core capability suffix) is within the measured cap", () => {
    const workspaces = [makeWs("alpha"), makeWs("beta"), makeWs("gamma")];
    const sys = getMultiWorkspaceSystemPrompt(workspaces, "alice", "");
    const suffix = composeCapabilityPromptSuffix([...CORE_CAPABILITIES], {
      slimPrompt: true,
    });
    const total = sys.length + suffix.length;
    // Measured post-slim total was ~35,606 chars (see
    // docs/jamie-prompt-slim/concepts.md §4); cap set with ~10% headroom.
    expect(total).toBeLessThan(39_200);
    // Guards against silent re-bloat back toward the pre-slim ~65k size.
    expect(total).toBeLessThan(50_000);
  });
});
