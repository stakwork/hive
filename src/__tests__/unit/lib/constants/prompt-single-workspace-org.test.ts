import { describe, it, expect } from "vitest";
import {
  getQuickAskPrefixMessages,
  type SingleWorkspaceOrgContext,
} from "@/lib/constants/prompt";

/**
 * Single-workspace org overlay for the quick-ask (per-workspace) prompt.
 *
 * Jamie gets ONE system prompt, but still needs to know which workspace
 * slug to pass to org-level tools (`propose_feature`, …) when the org
 * has exactly one workspace — the multi-workspace prompt always carries
 * an "Available Workspaces" list; the single-workspace prompt historically
 * did not name the workspace at all. `orgContext.workspace` closes that gap.
 */

const REPO = "https://github.com/acme/senza";

function systemPromptFor(orgContext?: SingleWorkspaceOrgContext): string {
  const msgs = getQuickAskPrefixMessages(
    [], // concepts
    [REPO], // repoUrls
    null, // clueMsgs
    "Rails monolith", // description
    undefined, // members
    orgContext,
  );
  const system = msgs.find((m) => m.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

describe("getQuickAskPrefixMessages — single-workspace org overlay", () => {
  it("names the bound workspace in an Available Workspaces section", () => {
    const content = systemPromptFor({
      orgId: "org-1",
      workspace: {
        name: "Senza",
        slug: "senza",
        swarmDomain: "swarm12.sphinx.chat",
      },
    });

    expect(content).toContain("## Available Workspaces & Repositories");
    // Same entry shape as the multi-workspace list.
    expect(content).toContain(
      "- **Senza** (slug: `senza`, swarm: `swarm12.sphinx.chat`) — Rails monolith: " +
        REPO,
    );
    // The slug is given as the exact value to pass to org tools.
    expect(content).toContain("pass exactly `senza`");
    expect(content).toContain("`propose_feature`");
  });

  it("omits the swarm segment when swarmDomain is absent", () => {
    const content = systemPromptFor({
      orgId: "org-1",
      workspace: { name: "Senza", slug: "senza" },
    });
    expect(content).toContain("- **Senza** (slug: `senza`) — Rails monolith: ");
    expect(content).not.toContain("swarm:");
  });

  it("omits the section when orgContext carries no workspace (back-compat)", () => {
    const content = systemPromptFor({ orgId: "org-1" });
    expect(content).not.toContain("## Available Workspaces & Repositories");
  });

  it("omits the section entirely without orgContext (dashboard chat)", () => {
    const content = systemPromptFor(undefined);
    expect(content).not.toContain("## Available Workspaces & Repositories");
    expect(content).not.toContain("propose_feature");
  });
});
