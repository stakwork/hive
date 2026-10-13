import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { getMultiWorkspaceSystemPrompt } from "@/lib/constants/prompt";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import { composeCapabilityPromptSuffix, ALL_CAPABILITIES } from "@/lib/ai/capabilities";
import type { WorkspaceConfig } from "@/lib/ai/types";

vi.mock("gitsee/server", () => ({ RepoAnalyzer: vi.fn() }));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));

/**
 * Full mode is the A/B control arm: its prompt and per-workspace toolset
 * must not drift while concept mode is built beside it. Snapshots were
 * captured from the branch BEFORE concept mode landed.
 */

function ws(slug: string, extra: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    slug,
    name: `Workspace ${slug}`,
    description: `The ${slug} workspace`,
    swarmUrl: `https://swarm.${slug}.test:3355`,
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`, `https://github.com/owner/${slug}-2`],
    pat: "pat",
    workspaceId: `${slug}-id`,
    userId: "user-1",
    members: [{ name: "Ada", githubUsername: "ada", role: "OWNER", description: "Lead" }],
    swarmDomain: `swarm-${slug}.sphinx.chat`,
    ...extra,
  };
}

const WORKSPACES = [
  ws("alpha", { isOrgDefault: true, currentUserGithubUsername: "ada" }),
  ws("stakwork"),
  ws("openlaw", { repoUrls: ["https://github.com/owner/openlaw"] }),
];

describe("full mode snapshot", () => {
  // The prompt opens with the current date; pin the clock.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
  });
  afterAll(() => vi.useRealTimers());

  it("getMultiWorkspaceSystemPrompt is unchanged", () => {
    expect(getMultiWorkspaceSystemPrompt(WORKSPACES, "ada", "PERSONA TEXT", "UTC")).toMatchSnapshot();
  });

  it("composeCapabilityPromptSuffix(ALL) is unchanged", () => {
    expect(composeCapabilityPromptSuffix(ALL_CAPABILITIES)).toMatchSnapshot();
  });

  it("askToolsMulti tool names are unchanged", () => {
    const names = Object.keys(askToolsMulti(WORKSPACES, "api-key", { alpha: [], stakwork: [], openlaw: [] })).sort();
    expect(names).toMatchSnapshot();
  });
});
