import { describe, it, expect } from "vitest";
import {
  getMultiWorkspaceSystemPrompt,
  getWorkflowsCapabilitySnippet,
  getGraphWalkerCapabilitySnippet,
} from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/types";

/**
 * "Workflow" means strut by default. Every place the prompt mentions a
 * Stakwork workflow surface must say it is for requests that explicitly
 * name Stakwork, and send a bare "workflow" to the `strut` capability.
 * (The core rule itself is covered in prompt-roadmap-snippet.test.ts.)
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

describe("getGraphWalkerCapabilitySnippet — Stakwork Workflow nodes", () => {
  it("marks the kg Workflow nodes as Stakwork's and sends a bare workflow to strut", () => {
    const snippet = getGraphWalkerCapabilitySnippet();
    expect(snippet).toContain(
      'They are Stakwork workflows — a bare "workflow" means a strut workflow, which is not a kg node: that is the `strut` capability.'
    );
  });
});

describe("getMultiWorkspaceSystemPrompt — logs_agent and workflow run logs", () => {
  it("scopes workflow run logs to Stakwork and points strut runs at the strut capability", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha")]);
    expect(prompt).toContain(
      "Stakwork workflow **run** logs (only when they name Stakwork — a strut workflow's run is evaluated through the `strut` capability, not here)"
    );
    expect(prompt).not.toContain("stakwork/workflow **run** logs");
  });
});
