import { describe, it, expect } from "vitest";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import type { WorkspaceConfig } from "@/lib/ai/types";

/** Minimal `WorkspaceConfig` factory — just enough to exercise the tool. */
function ws(slug: string, overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    slug,
    name: slug,
    swarmUrl: `https://swarm.${slug}.test`,
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `${slug}-id`,
    userId: "user-id",
    members: [],
    ...overrides,
  };
}

describe("askToolsMulti", () => {
  describe("read_concepts_for_repo registration gating", () => {
    it("does NOT register when fewer than 3 workspaces (no trim mode)", () => {
      const tools = askToolsMulti([ws("a"), ws("b")], "api-key", {
        a: [{ id: "owner/a/x", name: "X", description: "x", repo: "owner/a" }],
        b: [],
      });
      expect(tools).not.toHaveProperty("a__read_concepts_for_repo");
      expect(tools).not.toHaveProperty("b__read_concepts_for_repo");
    });

    it("does NOT register when concepts cache is omitted, even with 3+ workspaces", () => {
      const tools = askToolsMulti([ws("a"), ws("b"), ws("c")], "api-key");
      expect(tools).not.toHaveProperty("a__read_concepts_for_repo");
    });

    it("DOES register when 3+ workspaces AND concepts are provided", () => {
      const tools = askToolsMulti(
        [ws("a"), ws("b"), ws("c")],
        "api-key",
        { a: [], b: [], c: [] },
      );
      expect(tools).toHaveProperty("a__read_concepts_for_repo");
      expect(tools).toHaveProperty("b__read_concepts_for_repo");
      expect(tools).toHaveProperty("c__read_concepts_for_repo");
    });
  });

  describe("stakwork__search_workflows tool", () => {
    it("is registered for a workspace with slug 'stakwork'", () => {
      const tools = askToolsMulti(
        [ws("stakwork", { swarmUrl: "https://stakwork.sphinx.chat:3355" })],
        "api-key",
      );
      expect(tools).toHaveProperty("stakwork__search_workflows");
    });

    it("is absent for non-stakwork workspaces", () => {
      const tools = askToolsMulti([ws("other"), ws("another")], "api-key");
      expect(tools).not.toHaveProperty("other__search_workflows");
      expect(tools).not.toHaveProperty("another__search_workflows");
    });

    it("is only registered for the stakwork workspace when mixed", () => {
      const tools = askToolsMulti(
        [ws("other"), ws("stakwork", { swarmUrl: "https://stakwork.sphinx.chat:3355" }), ws("third")],
        "api-key",
      );
      expect(tools).toHaveProperty("stakwork__search_workflows");
      expect(tools).not.toHaveProperty("other__search_workflows");
      expect(tools).not.toHaveProperty("third__search_workflows");
    });
  });

  describe("per-workspace tool registration", () => {
    it("registers a slug-prefixed logs_agent for each workspace", () => {
      const tools = askToolsMulti([ws("alpha"), ws("beta")], "api-key");
      expect(tools).toHaveProperty("alpha__logs_agent");
      expect(tools).toHaveProperty("beta__logs_agent");
    });

    it("keeps logs_agent distinct from the lighter search_logs tool", () => {
      const tools = askToolsMulti([ws("alpha")], "api-key");
      expect(tools).toHaveProperty("alpha__logs_agent");
      expect(tools).toHaveProperty("alpha__search_logs");
      expect(tools.alpha__logs_agent).not.toBe(tools.alpha__search_logs);
    });
  });

  describe("read_concepts_for_repo execute", () => {
    const concepts = {
      hive: [
        {
          id: "stakwork/hive/auth",
          repo: "stakwork/hive",
          name: "Auth",
          description: "Authentication system",
          extraField: "should be stripped",
        },
        {
          id: "stakwork/hive/billing",
          repo: "stakwork/hive",
          name: "Billing",
          description: "Billing flows",
        },
        {
          id: "stakwork/other/foo",
          repo: "stakwork/other",
          name: "Foo",
          description: "unrelated",
        },
        // Legacy concept: no `repo` field, falls back to id prefix.
        {
          id: "stakwork/hive/legacy",
          name: "Legacy",
          description: "old shape",
        },
      ],
      a: [],
      b: [],
    };

    function getTool() {
      const tools = askToolsMulti(
        [ws("hive"), ws("a"), ws("b")],
        "api-key",
        concepts,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return tools["hive__read_concepts_for_repo"] as any;
    }

    it("returns only id+name+description for matching repo", async () => {
      const tool = getTool();
      const out = await tool.execute({ repo: "stakwork/hive" });
      expect(out).toEqual([
        { id: "stakwork/hive/auth", name: "Auth", description: "Authentication system" },
        { id: "stakwork/hive/billing", name: "Billing", description: "Billing flows" },
        { id: "stakwork/hive/legacy", name: "Legacy", description: "old shape" },
      ]);
    });

    it("matches via id prefix when concept lacks `repo` (legacy fallback)", async () => {
      const tool = getTool();
      const out = await tool.execute({ repo: "stakwork/hive" });
      expect(out.map((c: { id: string }) => c.id)).toContain("stakwork/hive/legacy");
    });

    it("filters out non-matching repos", async () => {
      const tool = getTool();
      const out = await tool.execute({ repo: "stakwork/other" });
      expect(out).toEqual([
        { id: "stakwork/other/foo", name: "Foo", description: "unrelated" },
      ]);
    });

    it("is case-insensitive and tolerates leading/trailing slashes", async () => {
      const tool = getTool();
      const out = await tool.execute({ repo: "/Stakwork/HIVE/" });
      expect(out).toHaveLength(3);
    });

    it("respects `limit`", async () => {
      const tool = getTool();
      const out = await tool.execute({ repo: "stakwork/hive", limit: 2 });
      expect(out).toHaveLength(2);
      // recent-first order preserved
      expect(out[0].id).toBe("stakwork/hive/auth");
      expect(out[1].id).toBe("stakwork/hive/billing");
    });

    it("returns [] for unknown repo", async () => {
      const tool = getTool();
      const out = await tool.execute({ repo: "nobody/nothing" });
      expect(out).toEqual([]);
    });
  });
});
