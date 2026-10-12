import { describe, it, expect } from "vitest";
import {
  getMultiWorkspaceSystemPrompt,
  getConceptsCapabilitySnippet,
} from "@/lib/constants/prompt";
import { getSlimConceptsCapabilitySnippet } from "@/lib/constants/prompt-slim";
import {
  PLANNER_FORM_RULE,
  PLANNER_FORM_WAKE_RULE,
  GITHUB_ORG_RULE,
} from "@/lib/constants/prompt-rules";
import {
  ALL_CAPABILITIES,
  CAPABILITY_REGISTRY,
  composeCapabilityPromptSuffix,
} from "@/lib/ai/capabilities";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { getStrutCapabilitySnippet } from "@/lib/ai/strutTools";
import type { WorkspaceConfig } from "@/lib/ai/types";

// `buildInitiativeTools` only constructs `ToolSet` objects (descriptions
// are static strings) — it never touches the DB at build time, so no
// `@/lib/db` mock is needed here; only `execute()` calls would need one.

/**
 * Jamie's code-built prompt. Only two capabilities are core — `concepts`
 * and `strut` — so the capability suffix is their two snippets plus the
 * load-on-demand menu. `roadmap`, `planner` and `graph_walker` are tools
 * only: their rules ride in the tool descriptions (pinned by
 * `src/__tests__/unit/lib/ai/toolDescriptionRules.test.ts`, which also
 * carries the seed-list safety audit from
 * `docs/jamie-prompt-slim/concepts.md` §2).
 *
 * The slim-prompt toggle (concept-tree mode, opt-in via the per-browser
 * settings switch) now only swaps the `concepts` snippet for its slim
 * variant.
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

const CORE_CAPABILITIES = ["concepts", "strut"] as const;
const TOOLS_ONLY_CAPABILITIES = ["roadmap", "planner", "graph_walker"] as const;

const suffixFor = (slimPrompt: boolean) =>
  composeCapabilityPromptSuffix(ALL_CAPABILITIES, { slimPrompt });

describe("Jamie prompt — core capabilities", () => {
  it("only concepts and strut are core", () => {
    const core = ALL_CAPABILITIES.filter((cap) => CAPABILITY_REGISTRY[cap].core);
    expect(core).toEqual([...CORE_CAPABILITIES]);
  });

  it("roadmap, planner and graph_walker carry no prompt text — their tools do", () => {
    for (const cap of TOOLS_ONLY_CAPABILITIES) {
      expect(CAPABILITY_REGISTRY[cap].promptSnippet).toBeUndefined();
      expect(CAPABILITY_REGISTRY[cap].menuBlurb).toBeUndefined();
    }
    for (const slimPrompt of [false, true]) {
      const suffix = suffixFor(slimPrompt);
      expect(suffix).not.toContain("## Roadmap Tools");
      expect(suffix).not.toContain("## Feature Planning");
      expect(suffix).not.toContain("## Graph Walker Tools");
    }
  });

  it("inlines the concepts and strut snippets", () => {
    const suffix = suffixFor(false);
    expect(suffix).toContain(getConceptsCapabilitySnippet());
    expect(suffix).toContain(getStrutCapabilitySnippet());
  });

  it("never tells the agent to learn_capability a core or tools-only capability", () => {
    const text =
      getMultiWorkspaceSystemPrompt([makeWs("alpha")]) +
      suffixFor(false) +
      suffixFor(true);
    for (const cap of [...CORE_CAPABILITIES, ...TOOLS_ONLY_CAPABILITIES]) {
      expect(text).not.toMatch(
        new RegExp(`learn_capability\\(['"\`]${cap}['"\`]\\)`),
      );
    }
  });
});

describe("Jamie prompt — slim toggle", () => {
  it("on: swaps in the slim concepts snippet; strut is the same in both modes", () => {
    const suffix = suffixFor(true);
    expect(suffix).toContain(getSlimConceptsCapabilitySnippet());
    expect(suffix).not.toContain(getConceptsCapabilitySnippet());
    expect(suffix).toContain(getStrutCapabilitySnippet());
  });

  it("neither mode adds its own concept-tree entry (the system prompt owns it)", () => {
    for (const slimPrompt of [false, true]) {
      const suffix = suffixFor(slimPrompt);
      expect(suffix).not.toContain("walk your concept tree");
      expect(suffix).not.toContain("Glimmer");
    }
  });

  it("send_to_feature_planner carries PLANNER_FORM_RULE in both modes", () => {
    const send = buildInitiativeTools("org-1", "user-1")[
      "send_to_feature_planner"
    ] as { description: string };
    expect(send.description).toContain(PLANNER_FORM_RULE);
  });
});

describe("Jamie prompt — no hardcoded concepts", () => {
  it("names no concept from the tree — the rest is walked", () => {
    const text = suffixFor(false) + suffixFor(true);
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

describe("Jamie prompt — must-stay lines", () => {
  it("keeps the don't-know reply line verbatim", () => {
    expect(getMultiWorkspaceSystemPrompt([makeWs("alpha")])).toContain(
      'If you really can\'t find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don\'t know the answer to that question, I\'ll look into it."',
    );
  });

  it("keeps the GITHUB_ORG_RULE in the workspace guidance", () => {
    expect(getMultiWorkspaceSystemPrompt([makeWs("alpha")])).toContain(
      GITHUB_ORG_RULE,
    );
  });

  it("the Tool Naming Convention keeps only the prefix rule — tools describe themselves", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha")]);
    expect(prompt).toContain("## Tool Naming Convention");
    expect(prompt).toContain(
      "**Tool names are exact — only those per-workspace tools carry a `{workspace}__` prefix.**",
    );
    expect(prompt).not.toContain("**Routing external questions:**");
    expect(prompt).not.toContain("`{workspace}__search_logs` - Search");
    expect(prompt).not.toContain("`{workspace}__repo_agent` - Deep code analysis");
  });

  it("no 'admin-only' claim anywhere in the prompt", () => {
    expect(getMultiWorkspaceSystemPrompt([makeWs("alpha")])).not.toContain(
      "admin-only",
    );
    expect(suffixFor(false)).not.toContain("admin-only");
    expect(suffixFor(true)).not.toContain("admin-only");
  });
});

describe("Jamie prompt — tool text carries moved rules", () => {
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

describe("Jamie prompt — autoturn wake message", () => {
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

describe("Jamie prompt — size cap", () => {
  it("the code-built prompt (system + full capability suffix) is within the measured cap", () => {
    const workspaces = [makeWs("alpha"), makeWs("beta"), makeWs("gamma")];
    const sys = getMultiWorkspaceSystemPrompt(workspaces, "alice", "");
    for (const slimPrompt of [false, true]) {
      const total = sys.length + suffixFor(slimPrompt).length;
      // Measured ~15.8k chars with concepts + strut as the only core
      // snippets and the Tool Naming Convention cut to the prefix rule
      // (was ~65k before the capability split, ~35.6k in slim mode — see
      // docs/jamie-prompt-slim/concepts.md §4); cap set with ~10%
      // headroom so re-bloat fails here.
      expect(total).toBeLessThan(17_400);
    }
  });
});
