import { describe, it, expect, vi } from "vitest";
import { asSchema, type ToolSet } from "ai";
import { CONCEPT_MODE_CAPABILITY_TOOLS, buildConceptModeTools, sortToolsByName } from "@/lib/ai/conceptModeTools";
import {
  ALL_CAPABILITIES,
  CAPABILITY_REGISTRY,
  type CapabilityContext,
  type OrgCapability,
} from "@/lib/ai/capabilities";
import type { WorkspaceConfig } from "@/lib/ai/types";
import { CONCEPT_MODE_TOOL_NAMES_52 } from "../../../fixtures/concept-mode-tools";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("gitsee/server", () => ({ RepoAnalyzer: vi.fn() }));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
const repoAgent = vi.fn(async () => ({ content: "repo agent answer" }));
vi.mock("@/lib/ai/askTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/askTools")>()),
  repoAgent: (...a: unknown[]) => repoAgent(...(a as [])),
}));
vi.mock("@/services/bifrost/orchestrator", () => ({ getBifrostForLLM: vi.fn(async () => undefined) }));

function ws(slug: string): WorkspaceConfig {
  return {
    slug,
    name: slug,
    swarmUrl: `https://swarm.${slug}.test:3355`,
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `${slug}-id`,
    userId: "user-1",
    members: [],
  };
}

const CTX: CapabilityContext = {
  orgId: "org-1",
  userId: "user-1",
  webSearch: { tool: undefined, results: [], capture: () => {} } as never,
  graphWriteEnabled: true,
};

const build = (slugs: string[], orgCapabilities: readonly OrgCapability[] = ALL_CAPABILITIES, ctx = CTX) =>
  buildConceptModeTools({
    workspaceConfigs: slugs.map(ws),
    orgCapabilities,
    capabilityContext: ctx,
  });

describe("buildConceptModeTools", () => {
  it("is the 52-tool set minus the three tools added elsewhere (web_search, web_fetch, schedule_check)", () => {
    const names = Object.keys(build(["alpha", "beta"]));
    const expected = CONCEPT_MODE_TOOL_NAMES_52.filter(
      (n) => !["web_search", "web_fetch", "schedule_check"].includes(n),
    );
    expect(names).toEqual([...expected].sort());
    expect(names).toHaveLength(49);
  });

  it("has no per-workspace `{slug}__` names", () => {
    expect(Object.keys(build(["alpha", "beta"])).filter((n) => n.includes("__"))).toEqual([]);
  });

  it("every name in the table is one the registry's builders actually produce", () => {
    for (const cap of ALL_CAPABILITIES) {
      const keep = CONCEPT_MODE_CAPABILITY_TOOLS[cap];
      if (!keep) continue;
      const built = CAPABILITY_REGISTRY[cap].buildTools(CTX);
      for (const name of keep) expect(Object.keys(built), `${cap} builds ${name}`).toContain(name);
    }
  });

  it("drops what concept mode leaves out", () => {
    const names = Object.keys(build(["alpha", "beta"]));
    for (const gone of [
      "list_concepts",
      "learn_concept",
      "recent_commits",
      "list_features",
      "check_status",
      "unassign_feature_from_workspace",
      "dispatch_graph_walk",
      "finalize_graph_walk",
      "save_connection",
      "read_pod_infra",
      "workflow_explorer_agent",
      "learn_capability",
      "send_sphinx_message",
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it("honours the graph-write gate and the capability gates", () => {
    const names = Object.keys(
      build(
        ["alpha"],
        ALL_CAPABILITIES.filter((c) => c !== "prompts" && c !== "strut"),
        {
          ...CTX,
          graphWriteEnabled: false,
        },
      ),
    );
    expect(names).not.toContain("propose_create_node");
    expect(names).not.toContain("get_prompt");
    expect(names).not.toContain("dispatch_strut");
    expect(names).toContain("graph_get");
    expect(names).toContain("repo_agent");
  });

  it("sortToolsByName orders by name", () => {
    const sorted = sortToolsByName({ b: {}, a: {}, c: {} } as unknown as ToolSet);
    expect(Object.keys(sorted)).toEqual(["a", "b", "c"]);
  });
});

describe("workspace-scoped tools", () => {
  const tools = build(["alpha", "beta"]);
  type Exec = (input: Record<string, unknown>) => Promise<unknown>;
  const exec = (name: string): Exec => (tools[name] as unknown as { execute: Exec }).execute;
  const schemaOf = (name: string) =>
    asSchema((tools[name] as { inputSchema: Parameters<typeof asSchema>[0] }).inputSchema);

  it("require a `workspace` slug enum of the org's slugs", () => {
    for (const name of ["repo_agent", "logs_agent", "search_logs"]) {
      const json = schemaOf(name).jsonSchema as {
        required?: string[];
        properties: Record<string, { enum?: string[] }>;
      };
      expect(json.required).toContain("workspace");
      expect(json.properties.workspace.enum).toEqual(["alpha", "beta"]);
    }
  });

  it("describe the workspace argument without a [slug] prefix", () => {
    for (const name of ["repo_agent", "logs_agent", "search_logs"]) {
      const d = (tools[name] as { description: string }).description;
      expect(d).toContain("`workspace`");
      expect(d).not.toMatch(/^\[/);
      expect(d).not.toContain("__");
    }
  });

  it("reject an unknown slug with an error listing the valid ones", async () => {
    const out = await exec("repo_agent")({ prompt: "q", workspace: "nope" });
    expect(out).toContain('Unknown workspace "nope"');
    expect(out).toContain("alpha, beta");
    expect(repoAgent).not.toHaveBeenCalled();
    // …and the schema itself refuses it before execute ever runs.
    const res = await schemaOf("repo_agent").validate?.({ prompt: "q", workspace: "nope" });
    expect(res?.success).toBe(false);
  });

  it("delegate to the same body askToolsMulti uses, for the chosen workspace", async () => {
    const out = await exec("repo_agent")({ prompt: "q", workspace: "beta" });
    expect(out).toBe("repo agent answer");
    expect(repoAgent).toHaveBeenCalledWith(
      "https://swarm.beta.test:3355",
      "key",
      expect.objectContaining({ repo_url: "https://github.com/owner/beta" }),
      undefined,
      undefined,
    );
  });

  it("default the workspace for a one-workspace org", async () => {
    const solo = build(["only"]);
    const json = asSchema((solo.repo_agent as { inputSchema: Parameters<typeof asSchema>[0] }).inputSchema)
      .jsonSchema as { required?: string[] };
    expect(json.required ?? []).not.toContain("workspace");
    repoAgent.mockClear();
    await (solo.repo_agent as unknown as { execute: Exec }).execute({ prompt: "q", workspace: "only" });
    expect(repoAgent).toHaveBeenCalledWith(
      "https://swarm.only.test:3355",
      "key",
      expect.anything(),
      undefined,
      undefined,
    );
  });
});
