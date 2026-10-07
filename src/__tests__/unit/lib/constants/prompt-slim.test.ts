import { describe, it, expect } from "vitest";
import {
  getMultiWorkspaceSystemPrompt,
  getRoadmapCapabilitySnippet,
  getPlannerCapabilitySnippet,
  getGraphWalkerCapabilitySnippet,
  getConceptsCapabilitySnippet,
  getGraphWalkDispatchSnippet,
} from "@/lib/constants/prompt";
import {
  getConceptTreeEntrySnippet,
  getSlimRoadmapCapabilitySnippet,
  getSlimPlannerCapabilitySnippet,
  getSlimGraphWalkerCapabilitySnippet,
  getSlimConceptsCapabilitySnippet,
} from "@/lib/constants/prompt-slim";
import {
  PLANNER_FORM_RULE,
  PLANNER_FORM_WAKE_RULE,
  GITHUB_ORG_RULE,
} from "@/lib/constants/prompt-rules";
import { composeCapabilityPromptSuffix } from "@/lib/ai/capabilities";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import type { WorkspaceConfig } from "@/lib/ai/types";

// `buildInitiativeTools` only constructs `ToolSet` objects (descriptions
// are static strings) — it never touches the DB at build time, so no
// `@/lib/db` mock is needed here; only `execute()` calls would need one.

/**
 * Jamie slim prompt (concept-tree mode, opt-in via `User.jamieSlimPrompt`)
 * — asserts the toggle selects the right text, the slim prompt carries a
 * single Glimmer entry point and no hardcoded concept names, every
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

const CORE_CAPABILITIES = ["roadmap", "planner", "graph_walker", "concepts"] as const;

const ALL_CAPABILITY_TEXT = () =>
  getSlimRoadmapCapabilitySnippet() +
  getSlimPlannerCapabilitySnippet() +
  getSlimGraphWalkerCapabilitySnippet() +
  getSlimConceptsCapabilitySnippet();

describe("Jamie slim prompt — toggle", () => {
  it("off: the suffix uses the full core snippets and no concept-tree entry", () => {
    const suffix = composeCapabilityPromptSuffix([...CORE_CAPABILITIES]);
    expect(suffix).toContain(getRoadmapCapabilitySnippet());
    expect(suffix).toContain(getPlannerCapabilitySnippet());
    expect(suffix).toContain(getGraphWalkerCapabilitySnippet());
    expect(suffix).toContain(getConceptsCapabilitySnippet());
    expect(suffix).not.toContain("Glimmer");
  });

  it("on: the suffix uses the slim core snippets, led by the concept-tree entry", () => {
    const suffix = composeCapabilityPromptSuffix([...CORE_CAPABILITIES], {
      slimPrompt: true,
    });
    expect(suffix.startsWith(getConceptTreeEntrySnippet())).toBe(true);
    expect(suffix).toContain(getSlimRoadmapCapabilitySnippet());
    expect(suffix).toContain(getSlimPlannerCapabilitySnippet());
    expect(suffix).toContain(getSlimGraphWalkerCapabilitySnippet());
    expect(suffix).toContain(getSlimConceptsCapabilitySnippet());
    expect(suffix).not.toContain(getRoadmapCapabilitySnippet());
  });

  it("send_to_feature_planner carries PLANNER_FORM_RULE only when on", () => {
    const off = buildInitiativeTools("org-1", "user-1")[
      "send_to_feature_planner"
    ] as { description: string };
    const on = buildInitiativeTools("org-1", "user-1", undefined, undefined, true)[
      "send_to_feature_planner"
    ] as { description: string };
    expect(off.description).not.toContain(PLANNER_FORM_RULE);
    expect(on.description).toContain(PLANNER_FORM_RULE);
  });
});

describe("Jamie slim prompt — concept-tree entry", () => {
  it("points at the Glimmer root in the hive workspace via graph_search", () => {
    const entry = getConceptTreeEntrySnippet();
    expect(entry).toContain("**Glimmer**");
    expect(entry).toContain(
      'graph_search({ query: "Glimmer", realm: "kg", workspace: "hive" })',
    );
    expect(entry).toContain("it never overrides a rule in this prompt");
  });

  it("names no concept below the root — the rest is walked", () => {
    const text = getConceptTreeEntrySnippet() + ALL_CAPABILITY_TEXT();
    for (const name of [
      "Hive Roadmap and Canvas",
      "Jamie Roadmap Proposals",
      "Jamie Managing Feature Planners",
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
    // 3. FORM rule → PLANNER_FORM_RULE (deliberate change)
    PLANNER_FORM_RULE,
    // 4. graph_query is member-scoped, not admin-only
    "any member of the named workspace",
    // 5. Never invent a contract
    "Never invent a contract",
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

  it("rule 8 (cycles rejected) is kept in the propose_feature tool's dependsOn* describe() text", () => {
    const tools = buildInitiativeTools("org-1", "user-1");
    const proposeFeature = tools["propose_feature"] as {
      inputSchema: { shape: Record<string, { description?: string }> };
    };
    expect(proposeFeature).toBeDefined();
    const shape = proposeFeature.inputSchema.shape;
    const depA = String(shape.dependsOnFeatureIds?.description ?? "");
    const depB = String(shape.dependsOnProposalIds?.description ?? "");
    const combined = depA + depB;
    expect(combined).toContain(
      "Cycles, including two proposals that depend on each other, are rejected",
    );
    expect(combined).toContain("Never create mutual dependencies.");
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

  it("no learn_capability(<core capability>) call in any quote style", () => {
    const text =
      ALL_CAPABILITY_TEXT() + getGraphWalkDispatchSnippet();
    for (const cap of CORE_CAPABILITIES) {
      expect(text).not.toMatch(
        new RegExp(`learn_capability\\(['"\`]${cap}['"\`]\\)`),
      );
    }
    // graph_walker specifically used to be gated behind learn_capability
    expect(text).not.toContain('learn_capability("graph_walker")');
    expect(text).not.toContain("learn_capability('graph_walker')");
  });
});

describe("Jamie slim prompt — tool text carries moved rules", () => {
  it("send_to_feature_planner description has the IN_PROGRESS re-check wording", () => {
    const tools = buildInitiativeTools("org-1", "user-1");
    const send = tools["send_to_feature_planner"] as { description: string };
    expect(send.description).toContain(
      "the tool re-checks every 2.5s for up to ~20s",
    );
    expect(send.description).toContain("re-read the feature later and retry");
  });

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

describe("Jamie slim prompt — autoturn wake message", () => {
  it("the form wake branch contains both FORM rules", async () => {
    const fs = await import("fs/promises");
    const path = await import("path");
    const src = await fs.readFile(
      path.resolve(process.cwd(), "src/services/canvas-agent-autoturn.ts"),
      "utf-8",
    );
    expect(src).toContain(
      "This wake reason is \\`form\\`. ${PLANNER_FORM_RULE} ${PLANNER_FORM_WAKE_RULE}",
    );
  });

  it("PLANNER_FORM_WAKE_RULE states it wins over any earlier instruction", () => {
    expect(PLANNER_FORM_WAKE_RULE).toContain(
      "wins over any earlier instruction in this conversation",
    );
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
