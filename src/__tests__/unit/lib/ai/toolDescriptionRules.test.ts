import { describe, it, expect } from "vitest";
import { asSchema, type ToolSet } from "ai";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { buildCanvasTools } from "@/lib/ai/canvasTools";
import { buildGraphWalkerTools } from "@/lib/ai/graphWalkerTools";
import { buildGraphWriteTools } from "@/lib/ai/graphWriteTools";
import { buildConceptTools } from "@/lib/ai/conceptTools";
import { buildStrutTools } from "@/lib/ai/strutTools";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import type { CapabilityContext } from "@/lib/ai/capabilities";
import type { WorkspaceConfig } from "@/lib/ai/types";
import { PLANNER_FORM_RULE } from "@/lib/constants/prompt-rules";
import {
  PROPOSE_CONCEPT_UPDATE_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_DELETE_EDGE_TOOL,
  PROPOSE_DELETE_NODE_TOOL,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  PROPOSE_MOVE_NODE_TOOL,
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
} from "@/lib/proposals/types";

/**
 * `roadmap`, `planner` and `graph_walker` are "tools only" capabilities:
 * they have no prompt snippet, so the rules their old snippets taught —
 * and the ones the system prompt's Tool Naming Convention taught — ride
 * on the tools they govern. One needle per rule, matched against the
 * tool's description plus its parameter descriptions.
 */

function toolText(tools: ToolSet, name: string): string {
  const t = tools[name] as { description?: string; inputSchema: unknown } | undefined;
  expect(t, `tool ${name} is registered`).toBeDefined();
  const schema = asSchema(t!.inputSchema as Parameters<typeof asSchema>[0]);
  return `${t!.description ?? ""}\n${JSON.stringify(schema.jsonSchema)}`;
}

function expectRules(tools: ToolSet, name: string, needles: string[]) {
  const text = toolText(tools, name);
  for (const needle of needles) {
    expect(text, `${name} should carry: ${needle}`).toContain(needle);
  }
}

describe("tool descriptions carry the rules the capability snippets taught", () => {
  it("planner tools", () => {
    const tools = buildInitiativeTools("org-1", "user-1");
    expectRules(tools, "send_to_feature_planner", [
      PLANNER_FORM_RULE,
      "React to the planner's last message.",
      "One stage per message.",
      "brief → requirements → architecture → tasks",
      "**Start Tasks** button",
      "`@that-workspace`",
      "belong in that feature's plan chat",
      "one message per affected feature",
    ]);
    expectRules(tools, "cancel_feature_planner", ["the run already ended"]);
    expectRules(tools, "read_user_activity", ["it spans every workspace"]);
  });

  it("roadmap tools", () => {
    const tools = buildInitiativeTools("org-1", "user-1");
    expectRules(tools, "read_initiative", ["Initiatives table"]);
    expectRules(tools, "read_milestone", ["Initiatives table"]);
    expectRules(tools, PROPOSE_INITIATIVE_TOOL, [
      "don't ask permission first",
      "use `assign_feature_to_initiative` instead",
      "one `propose_feature` per workspace involved",
    ]);
    // Milestones have their own propose tool — the '+' button is only
    // for Workspaces / Repositories.
    expect(toolText(tools, PROPOSE_INITIATIVE_TOOL)).not.toContain(
      "Repositories / Milestones",
    );
    expectRules(tools, PROPOSE_FEATURE_TOOL, [
      "don't ask permission first",
      "**When NOT to propose:**",
      "a focused change in ONE repository goes through a job (`start_job`)",
      "any schema change or data migration",
      "one feature PER WORKSPACE involved",
      "`dependsOnProposalIds` on the blocked feature",
      "a feature in the `stakwork` workspace if that workspace is listed; " +
        "otherwise ask which workspace owns the workflow",
    ]);
    expectRules(tools, PROPOSE_MILESTONE_TOOL, ["don't ask permission first"]);
  });

  it("read_canvas points connection edges at read_connection", () => {
    expectRules(buildCanvasTools("org-1"), "read_canvas", [
      "`customData.connectionId`",
      "`read_connection`",
    ]);
  });

  it("graph read tools", () => {
    const tools = buildGraphWalkerTools("org-1", "user-1");
    expectRules(tools, "graph_neighbors", [
      "best-effort `title`",
      "HiveFeature -HAS_TASK-> HiveTask -RESULTED_IN-> PullRequest -> File",
    ]);
    expectRules(tools, "graph_get", ["build one only from a returned `ref_id`"]);
    expectRules(tools, "graph_search", [
      "exist only in the `stakwork` workspace's kg",
    ]);
  });

  it("graph-write propose tools", () => {
    const tools = buildGraphWriteTools("org-1", "user-1");
    for (const name of [
      PROPOSE_CREATE_NODE_TOOL,
      PROPOSE_NODE_EDIT_TOOL,
      PROPOSE_CREATE_TRIPLET_TOOL,
      PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
      PROPOSE_DELETE_EDGE_TOOL,
      PROPOSE_MOVE_NODE_TOOL,
      PROPOSE_DELETE_NODE_TOOL,
    ]) {
      expectRules(tools, name, [
        "one sent through another workspace fails silently",
        "confirm the workspace with the user first",
      ]);
    }
    expectRules(tools, PROPOSE_CREATE_NODE_TOOL, [
      "`get_ontology_type`",
      "`alreadyExisted: true`",
    ]);
    expectRules(tools, PROPOSE_CREATE_TRIPLET_TOOL, [
      "Prefer a ref_id when the node is already known",
      "never from a finalize_graph_walk answer",
      "`alreadyExisted: true`",
    ]);
    expectRules(tools, PROPOSE_DELETE_EDGE_TOOL, [
      "(`forward` means the queried node is the source)",
      "One relationship per card",
    ]);
    expectRules(tools, PROPOSE_DELETE_NODE_TOOL, ["the node it duplicates"]);
  });

  it("concept tools", () => {
    const tools = buildConceptTools("org-1", "user-1");
    expectRules(tools, PROPOSE_NEW_CONCEPT_TOOL, [
      "'note this down'",
      "'add this to the knowledge base'",
      "lead with what it is and why it matters",
    ]);
    expectRules(tools, PROPOSE_CONCEPT_UPDATE_TOOL, [
      "`read_concept_documentation`",
    ]);
  });

  it("start_job keeps a code change to one repository", () => {
    const tools = buildStrutTools({
      orgId: "org-1",
      userId: "user-1",
      currentCanvasConversationId: "conv-1",
      webSearch: {},
    } as unknown as CapabilityContext);
    expectRules(tools, "start_job", [
      "a focused change in ONE repository",
      "goes through `propose_feature` instead",
      "never pick a repository just because",
    ]);
  });

  it("per-workspace tools", () => {
    const ws = {
      slug: "alpha",
      name: "Alpha",
      swarmUrl: "https://swarm.example.com",
      swarmApiKey: "key",
      repoUrls: ["https://github.com/owner/alpha"],
      pat: "pat",
      workspaceId: "ws-alpha",
      userId: "user-1",
      members: [],
    } as unknown as WorkspaceConfig;
    const tools = askToolsMulti([ws], "api-key");
    expectRules(tools, "alpha__repo_agent", ["use `web_search` for those"]);
    expectRules(tools, "alpha__logs_agent", [
      "a strut workflow's run is evaluated through strut",
    ]);
    expectRules(tools, "alpha__check_status", ["`read_user_activity`"]);
    expectRules(tools, "alpha__list_features", ["what's being worked on"]);
  });
});

/**
 * The seed-list safety audit (`docs/jamie-prompt-slim/concepts.md` §2):
 * one string per rule, in the tool text that now carries it. Rule 9 (a
 * GitHub org is not a workspace) stays in the system prompt — see
 * `prompt-slim.test.ts`.
 */
describe("seed-list safety rules live on the tools", () => {
  const initiative = buildInitiativeTools("org-1", "user-1");
  const graphRead = buildGraphWalkerTools("org-1", "user-1");
  const graphWrite = buildGraphWriteTools("org-1", "user-1");

  it("1. propose, don't write", () => {
    for (const name of [PROPOSE_INITIATIVE_TOOL, PROPOSE_FEATURE_TOOL, PROPOSE_MILESTONE_TOOL]) {
      expectRules(initiative, name, ["does NOT write to the DB"]);
    }
    expectRules(graphWrite, PROPOSE_CREATE_NODE_TOOL, [
      "no write happens until the user clicks Approve",
    ]);
  });

  it("2. repo_agent is read-only", () => {
    const ws = {
      slug: "alpha",
      name: "Alpha",
      swarmUrl: "https://swarm.example.com",
      swarmApiKey: "key",
      repoUrls: ["https://github.com/owner/alpha"],
      pat: "pat",
      workspaceId: "ws-alpha",
      userId: "user-1",
      members: [],
    } as unknown as WorkspaceConfig;
    expectRules(askToolsMulti([ws], "api-key"), "alpha__repo_agent", [
      "STRICTLY READ-ONLY",
    ]);
  });

  it("3. never answer a planner's FORM on your own", () => {
    expectRules(initiative, "send_to_feature_planner", [PLANNER_FORM_RULE]);
  });

  it("4. graph_query is member-scoped, not admin-only", () => {
    expectRules(graphRead, "graph_query", ["Any workspace member may call this"]);
    expect(toolText(graphRead, "graph_query")).not.toContain("admin-only");
  });

  it("5. never invent a contract", () => {
    expectRules(initiative, PROPOSE_FEATURE_TOOL, [
      "NEVER guess or fabricate endpoint paths, field names, or types",
    ]);
    expectRules(initiative, "send_to_feature_planner", [
      "must be confirmed there",
    ]);
  });

  it("6. URNs come from the graph, not from scratch", () => {
    expectRules(graphRead, "graph_get", ["build one only from a returned `ref_id`"]);
  });

  it("7. mirror-owned graph node types are not editable", () => {
    expectRules(graphWrite, PROPOSE_NODE_EDIT_TOOL, ["are not editable"]);
    expectRules(graphWrite, PROPOSE_MOVE_NODE_TOOL, ["Refused for mirror-owned node types"]);
    expectRules(graphWrite, PROPOSE_DELETE_NODE_TOOL, ["Refused for mirror-owned node types"]);
  });

  it("8. cycles are rejected", () => {
    expectRules(initiative, PROPOSE_FEATURE_TOOL, [
      "Cycles, including two proposals that depend on each other, are rejected",
      "Never create mutual dependencies.",
    ]);
    expectRules(graphWrite, PROPOSE_MOVE_NODE_TOOL, ["(a cycle)"]);
  });
});
