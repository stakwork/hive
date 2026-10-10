import { describe, it, expect } from "vitest";
import { getWorkflowsCapabilitySnippet } from "@/lib/constants/prompt";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import { buildGraphWalkerTools } from "@/lib/ai/graphWalkerTools";
import type { WorkspaceConfig } from "@/lib/ai/types";

/**
 * "Workflow" means strut by default. Every place the prompt or a tool
 * mentions a Stakwork workflow surface must say it is for requests that
 * explicitly name Stakwork, and send a bare "workflow" to strut. (The
 * core rule itself is the core `strut` snippet — see strutTools.test.ts.)
 */

function makeWs(slug: string): WorkspaceConfig {
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
  };
}

describe("getWorkflowsCapabilitySnippet — Stakwork-only", () => {
  it("tells the agent the explorer is for explicit Stakwork requests and a bare workflow is strut", () => {
    const snippet = getWorkflowsCapabilitySnippet();
    expect(snippet).toContain("ONLY when the user has explicitly named Stakwork.");
    expect(snippet).toContain(
      'A bare "workflow" — build, revise, run, or evaluate one — is a strut workflow: that is the `strut` capability (`dispatch_strut`), never this tool.'
    );
  });
});

describe("graph_search — Stakwork Workflow nodes", () => {
  it("marks the kg Workflow nodes as Stakwork's and says a bare workflow is strut", () => {
    const tools = buildGraphWalkerTools("org-1", "user-1") as unknown as Record<
      string,
      { description: string }
    >;
    expect(tools.graph_search.description).toContain(
      "`Workflow` nodes are Stakwork workflows and exist only in the `stakwork` workspace's kg; " +
        'a bare "workflow" means a strut workflow, which is not in the kg.'
    );
  });
});

describe("logs_agent — workflow run logs", () => {
  it("scopes workflow run logs to Stakwork and points strut runs at strut", () => {
    const tools = askToolsMulti([makeWs("alpha")], "api-key") as unknown as Record<
      string,
      { description: string }
    >;
    const description = tools.alpha__logs_agent.description;
    expect(description).toContain(
      "Stakwork workflow run logs, but only when the user names Stakwork"
    );
    expect(description).toContain(
      "a strut workflow's run is evaluated through strut (`dispatch_strut`), not here"
    );
  });
});
