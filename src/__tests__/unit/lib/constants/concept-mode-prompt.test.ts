import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  CANVAS_SCOPE_POINTER,
  getConceptPrefixMessages,
  getConceptSystemPrompt,
  getCurrentDateSnippet,
} from "@/lib/constants/prompt";
import { GITHUB_ORG_RULE } from "@/lib/constants/prompt-rules";
import type { WorkspaceConfig } from "@/lib/ai/types";

function ws(slug: string, extra: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    slug,
    name: `Workspace ${slug}`,
    description: `The ${slug} workspace`,
    swarmUrl: "https://swarm.test:3355",
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `${slug}-id`,
    userId: "user-1",
    members: [{ name: "Roster Person", githubUsername: "roster", role: "OWNER", description: "Lead" }],
    ...extra,
  };
}

const WORKSPACES = [ws("alpha", { isOrgDefault: true, swarmDomain: "swarm1.sphinx.chat" }), ws("beta")];

describe("getConceptSystemPrompt", () => {
  let prompt: string;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
    prompt = getConceptSystemPrompt(WORKSPACES, "alice", "PERSONA TEXT", "UTC");
  });
  afterAll(() => vi.useRealTimers());

  it("opens with the date line, then the persona passed in", () => {
    expect(prompt.trimStart().startsWith(getCurrentDateSnippet("UTC"))).toBe(true);
    expect(prompt.indexOf("PERSONA TEXT")).toBeGreaterThan(prompt.indexOf("Current date:"));
    expect(prompt.indexOf("## Available Workspaces")).toBeGreaterThan(prompt.indexOf("PERSONA TEXT"));
  });

  it("lists the workspaces exactly as full mode does", () => {
    expect(prompt).toContain("## Available Workspaces & Repositories");
    expect(prompt).toContain(
      "- **Workspace alpha** (slug: `alpha`, swarm: `swarm1.sphinx.chat`, **org default**) — The alpha workspace: https://github.com/owner/alpha",
    );
    expect(prompt).toContain("- **Workspace beta** (slug: `beta`) — The beta workspace: https://github.com/owner/beta");
  });

  it("states the workspace-argument rule and the complete-list rule", () => {
    expect(prompt).toContain("`repo_agent`, `logs_agent`, `search_logs`) take a `workspace` argument");
    expect(prompt).toContain("must be one of the slugs listed above");
    expect(prompt).toContain("Every other tool is global");
    expect(prompt).toContain("Tool names are exact");
    expect(prompt).toContain("complete set of workspaces");
    expect(prompt).toContain("say so and ask");
  });

  it("names the current user and ends with the end marker", () => {
    expect(prompt).toContain("**@alice**");
    expect(prompt.endsWith('When you are done print "[END_OF_ANSWER]"')).toBe(true);
  });

  it("drops the roster, the workspace essays, the naming convention and capability text", () => {
    for (const gone of [
      "Team Members",
      "Roster Person",
      GITHUB_ORG_RULE,
      "Honor the workspace the user mentions",
      "Tool Naming Convention",
      "learn_capability",
      "More capabilities",
      "## Concept Tools",
      "## Strut",
    ]) {
      expect(prompt).not.toContain(gone);
    }
  });

  it("is far smaller than the full prompt", () => {
    expect(prompt.length).toBeLessThan(2_500 + "PERSONA TEXT".length);
  });
});

describe("getConceptPrefixMessages", () => {
  it("is the system message plus history, with the canvas scope pointer and no seeded list_concepts pairs", () => {
    const history = [{ role: "user", content: "hi" }] as never[];
    const msgs = getConceptPrefixMessages(WORKSPACES, history, "PERSONA TEXT", "UTC");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(String(msgs[0].content).endsWith(CANVAS_SCOPE_POINTER)).toBe(true);
    expect(msgs[1]).toBe(history[0]);
  });

  it("never seeds concepts, even when seeding is enabled", () => {
    vi.stubEnv("CANVAS_CONCEPT_SEEDING", "true");
    try {
      const msgs = getConceptPrefixMessages(WORKSPACES, [], "PERSONA TEXT");
      expect(msgs).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("takes the current user from the first workspace", () => {
    const msgs = getConceptPrefixMessages([ws("a", { currentUserGithubUsername: "bob" })], [], "P");
    expect(String(msgs[0].content)).toContain("**@bob**");
  });
});
