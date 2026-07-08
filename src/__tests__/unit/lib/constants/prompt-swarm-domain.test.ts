import { describe, it, expect } from "vitest";
import { getMultiWorkspaceSystemPrompt } from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWs(slug: string, swarmDomain?: string): WorkspaceConfig {
  return {
    slug,
    name: `Workspace ${slug}`,
    swarmUrl: "https://swarm.example.com:3355",
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `ws-${slug}`,
    userId: "user-1",
    members: [],
    swarmDomain,
  };
}

// ─── swarmDomain rendering in workspace list ─────────────────────────────────

describe("getMultiWorkspaceSystemPrompt — swarmDomain rendering", () => {
  it("includes swarm: <domain> in workspace line when swarmDomain is set", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    expect(prompt).toContain("swarm: `swarm38.sphinx.chat`");
  });

  it("omits the swarm: segment entirely when swarmDomain is undefined", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", undefined)]);
    // No swarm segment should appear for this workspace
    expect(prompt).not.toMatch(/swarm: `[^`]+`/);
  });

  it("renders swarm domain alongside slug in the workspace list line", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    // The line should contain both slug and swarm in parentheses
    expect(prompt).toContain("slug: `alpha`, swarm: `swarm38.sphinx.chat`");
  });

  it("workspace without swarmDomain still renders slug correctly and has no swarm segment on its line", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("beta", undefined)]);
    expect(prompt).toContain("slug: `beta`");
    // The workspace list line for "beta" should not contain a swarm segment
    const lines = prompt.split("\n");
    const betaLine = lines.find((l) => l.includes("slug: `beta`"));
    expect(betaLine).toBeDefined();
    expect(betaLine).not.toContain("swarm:");
  });

  it("handles mixed workspaces — only those with swarmDomain show the swarm segment", () => {
    const prompt = getMultiWorkspaceSystemPrompt([
      makeWs("with-swarm", "swarm38.sphinx.chat"),
      makeWs("no-swarm", undefined),
    ]);
    expect(prompt).toContain("swarm: `swarm38.sphinx.chat`");
    // Verify the no-swarm workspace doesn't get a spurious swarm segment
    const lines = prompt.split("\n");
    const noSwarmLine = lines.find((l) => l.includes("slug: `no-swarm`"));
    expect(noSwarmLine).toBeDefined();
    expect(noSwarmLine).not.toContain("swarm:");
  });
});

// ─── app-host guidance reconciliation ────────────────────────────────────────

describe("getMultiWorkspaceSystemPrompt — app-host guidance", () => {
  it("preserves the path-slug rule for hive URLs", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    expect(prompt).toContain("/w/<slug>/");
    expect(prompt).toContain("/api/workspaces/<slug>/");
    expect(prompt).toContain("the workspace is `<slug>`");
  });

  it("still identifies hive.sphinx.chat as the app's own domain", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    expect(prompt).toContain("hive.sphinx.chat");
    // The app host should be described as NOT a workspace
    expect(prompt).toMatch(/hive\.sphinx\.chat.*NOT a workspace|NOT a workspace.*hive\.sphinx\.chat/s);
  });

  it("includes the bounded carve-out for listed swarm subdomains", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    // The carve-out should reference exactly-matching swarm values
    expect(prompt).toContain("exactly matches one of the `swarm:` values");
  });

  it("states that unmatched *.sphinx.chat hosts are NOT workspaces", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    expect(prompt).toContain("matches **no** listed `swarm:` value");
    expect(prompt).toMatch(/is NOT a workspace/);
  });

  it("hive.sphinx.chat is described as not a workspace even with swarm entries present", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha", "swarm38.sphinx.chat")]);
    // The guidance should explicitly call out hive.sphinx.chat as a no-match example
    expect(prompt).toContain("including the app host `hive.sphinx.chat`");
  });
});
