import { describe, it, expect } from "vitest";
import {
  getQuickAskPrefixMessages,
  type SingleWorkspaceOrgContext,
} from "@/lib/constants/prompt";

/**
 * Single-workspace org overlay for the quick-ask (per-workspace) prompt.
 *
 * The roadmap capability snippet tells the agent to take `workspaceSlug`
 * "from the Available Workspaces list at the top of the system prompt".
 * The multi-workspace prompt always carries that list; the single-
 * workspace prompt historically did not name the workspace at all, so an
 * org with exactly one workspace had `propose_feature` (once the org
 * toolset merges) but no stated slug to pass it. `orgContext.workspace`
 * closes that gap.
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
      promptSuffix: "<<CAPABILITY SUFFIX>>",
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

  it("places the workspace list BEFORE the capability suffix", () => {
    const content = systemPromptFor({
      orgId: "org-1",
      promptSuffix: "<<CAPABILITY SUFFIX>>",
      workspace: { name: "Senza", slug: "senza" },
    });
    const listAt = content.indexOf("## Available Workspaces & Repositories");
    const suffixAt = content.indexOf("<<CAPABILITY SUFFIX>>");
    expect(listAt).toBeGreaterThan(-1);
    expect(suffixAt).toBeGreaterThan(-1);
    // The roadmap snippet refers back to "the Available Workspaces list
    // at the top of the system prompt", so the list must precede it.
    expect(listAt).toBeLessThan(suffixAt);
  });

  it("omits the swarm segment when swarmDomain is absent", () => {
    const content = systemPromptFor({
      orgId: "org-1",
      promptSuffix: "",
      workspace: { name: "Senza", slug: "senza" },
    });
    expect(content).toContain("- **Senza** (slug: `senza`) — Rails monolith: ");
    expect(content).not.toContain("swarm:");
  });

  it("omits the section when orgContext carries no workspace (back-compat)", () => {
    const content = systemPromptFor({ orgId: "org-1", promptSuffix: "" });
    expect(content).not.toContain("## Available Workspaces & Repositories");
  });

  it("omits the section entirely without orgContext (dashboard chat)", () => {
    const content = systemPromptFor(undefined);
    expect(content).not.toContain("## Available Workspaces & Repositories");
    expect(content).not.toContain("propose_feature");
  });
});
