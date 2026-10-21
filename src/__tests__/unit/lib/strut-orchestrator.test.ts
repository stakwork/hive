/**
 * Unit tests for `lib/strut-orchestrator.ts` — the pure contract between
 * hive and strut's `orchestrator` workflow: the prompt's workspace line,
 * the context line, the proposal briefs as strut reports them, and the
 * mapping from a strut proposal's step + input onto hive's card bodies.
 */

import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_SILENT_MARKER,
  countTrailingJobRows,
  isOrchestratorSilentReply,
  ORCHESTRATOR_TURN_KIND,
  ORCHESTRATOR_WORKFLOW,
  orchestratorContextLine,
  orchestratorLaunchRowId,
  orchestratorPrompt,
  orchestratorRowId,
  parseOrchestratorJobCalls,
  parseStrutProposalBriefs,
  strutProposalRowId,
  strutProposalStepLabel,
  strutProposalToOutput,
} from "@/lib/strut-orchestrator";

const NOW = new Date("2026-10-19T13:02:00Z");

describe("the launch's input", () => {
  it("names the kind and the workflow", () => {
    expect(ORCHESTRATOR_TURN_KIND).toBe("orchestrator_turn");
    expect(ORCHESTRATOR_WORKFLOW).toBe("orchestrator");
  });

  it("puts the workspace line first, the message as typed under it", () => {
    expect(orchestratorPrompt("acme", "Add a Concept for billing retries")).toBe(
      "@acme\nAdd a Concept for billing retries",
    );
  });

  it("context.line is the time in the person's zone, then the zone; UTC when the zone is unknown", () => {
    expect(orchestratorContextLine(NOW, "Europe/London")).toBe("Mon 19 Oct, 14:02, Europe/London. ");
    expect(orchestratorContextLine(NOW, undefined)).toBe("Mon 19 Oct, 13:02, UTC. ");
    expect(orchestratorContextLine(NOW, "Nowhere/Zone")).toBe("Mon 19 Oct, 13:02, UTC. ");
  });
});

describe("the stay-silent convention", () => {
  it("the marker alone, however quoted or stopped, is silent; anything more is not", () => {
    expect(ORCHESTRATOR_SILENT_MARKER).toBe("[silent]");
    for (const text of ["[silent]", "[Silent]", " `[silent]` ", "**[silent]**", "'[silent]'.", "_[silent]_"]) {
      expect(isOrchestratorSilentReply(text)).toBe(true);
    }
    for (const text of ["", "silent", "[silent] ok", "ok [silent]", "[silent]\nmore", undefined]) {
      expect(isOrchestratorSilentReply(text)).toBe(false);
    }
  });
});

describe("countTrailingJobRows — the orchestrator wake's loop breaker", () => {
  const user = { role: "user" };
  const job = { role: "assistant", source: { kind: "job" } };
  const reply = { role: "assistant", source: { kind: "orchestrator" } };
  const launch = { role: "assistant", source: { kind: "orchestrator_launch" } };

  it("counts job rows back to the last human message, which resets the window", () => {
    expect(countTrailingJobRows([])).toBe(0);
    expect(countTrailingJobRows([user, reply, launch])).toBe(0);
    expect(countTrailingJobRows([user, job, reply, job, reply, job])).toBe(3);
    expect(countTrailingJobRows([job, job, user, launch, job])).toBe(1);
    expect(countTrailingJobRows([job, job, user])).toBe(0);
  });
});

describe("row ids", () => {
  it("are keyed on the turn's StrutRun id", () => {
    expect(orchestratorRowId("row-1")).toBe("orchestrator-row-1");
    expect(orchestratorLaunchRowId("row-1")).toBe("orchestrator-launch-row-1");
    expect(strutProposalRowId("row-1", "p3f9aKq2")).toBe("orchestrator-row-1-proposal-p3f9aKq2");
  });
});

describe("parseOrchestratorJobCalls — the jobs a turn launched, from its event log", () => {
  const start = (path: string, input: unknown, stepType = "tool:job_start") => ({
    type: "step.start",
    path,
    stepType,
    input,
  });
  const end = (path: string, output: unknown, stepType = "tool:job_start") => ({
    type: "step.end",
    path,
    stepType,
    output,
  });

  it("pairs each call's input (the title) with its result (the job and run), in call order", () => {
    expect(
      parseOrchestratorJobCalls([
        { type: "run.start", path: "orchestrator" },
        start("o/agent/001-job_start", { prompt: "p", title: "Flights" }),
        end("o/agent/001-job_start", '{"job":"j-1","runId":"r-1","callback":true}'),
        start("o/agent/002-job_continue", { job: "j-2", prompt: "go on" }, "tool:job_continue"),
        end("o/agent/002-job_continue", { job: "j-2", runId: "r-2", callback: true }, "tool:job_continue"),
      ]),
    ).toEqual([
      // A job/start that named no workflow launched strut's default; a job/continue says none.
      { job: "j-1", runId: "r-1", title: "Flights", workflow: "job" },
      { job: "j-2", runId: "r-2" },
    ]);
  });

  it("a job/start carries the workflow its input named — a builder job, with or without a peer", () => {
    expect(
      parseOrchestratorJobCalls([
        start("o/agent/001-job_start", { prompt: "p", title: "Digest", workflow: "builder", peer: "acme-web" }),
        end("o/agent/001-job_start", { job: "j-1", runId: "r-1", callback: true }),
        start("o/agent/002-job_start", '{"prompt":"p","title":"Local","workflow":"builder"}'),
        end("o/agent/002-job_start", '{"job":"j-2","runId":"r-2","callback":true}'),
      ]),
    ).toEqual([
      { job: "j-1", runId: "r-1", title: "Digest", workflow: "builder" },
      { job: "j-2", runId: "r-2", title: "Local", workflow: "builder" },
    ]);
  });

  it("skips a call that failed, other tools, the journal's own record and junk; a job launched twice keeps its last turn", () => {
    expect(
      parseOrchestratorJobCalls([
        start("a/001-job_start", { title: "X" }),
        { type: "step.error", path: "a/001-job_start", stepType: "tool:job_start", error: { message: "job_busy" } },
        end("a/002-graph", '{"job":"j-9","runId":"r-9"}', "tool:graph_search"),
        { type: "step.end", path: "a#002", output: { job: "j-8", runId: "r-8", callback: true } },
        end("a/003-job_start", "[… truncated"),
        null,
        end("a/004-job_continue", '{"job":"j-1","runId":"r-1"}', "tool:job_continue"),
        end("a/005-job_continue", '{"job":"j-1","runId":"r-5"}', "tool:job_continue"),
      ]),
    ).toEqual([{ job: "j-1", runId: "r-5" }]);
  });
});

describe("parseStrutProposalBriefs", () => {
  it("keeps whole briefs in order, defaults the status and url, drops the rest", () => {
    expect(
      parseStrutProposalBriefs([
        {
          id: "p1",
          step: "graph/create-node",
          title: "Create a node.",
          status: "pending",
          url: "/proposals/p1",
          rationale: "Missing page.",
          createdAt: "2026-10-19T13:00:00Z",
        },
        { id: "p2", step: "graph/delete-node", status: "nonsense" },
        { id: "", step: "graph/create-node" },
        { step: "graph/create-node", title: "no id" },
        "not a brief",
      ]),
    ).toEqual([
      {
        id: "p1",
        step: "graph/create-node",
        title: "Create a node.",
        status: "pending",
        url: "/proposals/p1",
        rationale: "Missing page.",
        createdAt: "2026-10-19T13:00:00Z",
      },
      { id: "p2", step: "graph/delete-node", title: "graph/delete-node", status: "pending", url: "/proposals/p2" },
    ]);
    expect(parseStrutProposalBriefs(undefined)).toEqual([]);
    expect(parseStrutProposalBriefs({ proposals: [] })).toEqual([]);
  });
});

describe("strutProposalToOutput — a strut step's input as a hive card body", () => {
  it("graph/create-node ↔ graphNodeCreate", () => {
    expect(
      strutProposalToOutput(
        "graph/create-node",
        { node_type: "Concept", node_data: { name: "Retries" }, namespace: "x" },
        "acme",
      ),
    ).toEqual({
      kind: "graphNodeCreate",
      proposalId: "strut",
      payload: { workspaceId: "", workspaceSlug: "acme", node_type: "Concept", node_data: { name: "Retries" } },
      meta: { workspaceSlug: "acme" },
    });
  });

  it("graph/create-triplet ↔ graphTripletCreate: strut's flat ends become hive's endpoint union", () => {
    expect(
      strutProposalToOutput(
        "graph/create-triplet",
        { source_ref_id: "r1", target_type: "Concept", target_data: { name: "B" }, edge_type: "PARENT_OF", weight: 2 },
        "acme",
      ),
    ).toEqual({
      kind: "graphTripletCreate",
      proposalId: "strut",
      payload: {
        workspaceId: "",
        workspaceSlug: "acme",
        edge_type: "PARENT_OF",
        weight: 2,
        source: { ref_id: "r1" },
        target: { node_type: "Concept", node_data: { name: "B" } },
      },
      meta: { workspaceSlug: "acme" },
    });
    // An end with neither a ref nor a type is not a triplet hive can draw.
    expect(strutProposalToOutput("graph/create-triplet", { edge_type: "PARENT_OF", target_ref_id: "r2" })).toBeNull();
  });

  it("graph/create-batch-triplet ↔ graphBatchTripletCreate, every whole triplet in order", () => {
    const out = strutProposalToOutput(
      "graph/create-batch-triplet",
      {
        triplets: [
          { source_ref_id: "parent", edge_type: "PARENT_OF", target_type: "Concept", target_data: { name: "B" } },
          { source_ref_id: "ws", edge_type: "PROCESS", target_type: "Concept", target_data: { name: "B" } },
          { edge_type: "BROKEN" },
        ],
      },
      "acme",
    );
    expect(out?.kind).toBe("graphBatchTripletCreate");
    expect(out && out.kind === "graphBatchTripletCreate" ? out.payload.triplets : []).toEqual([
      {
        edge_type: "PARENT_OF",
        source: { ref_id: "parent" },
        target: { node_type: "Concept", node_data: { name: "B" } },
      },
      { edge_type: "PROCESS", source: { ref_id: "ws" }, target: { node_type: "Concept", node_data: { name: "B" } } },
    ]);
    expect(strutProposalToOutput("graph/create-batch-triplet", { triplets: [] })).toBeNull();
  });

  it("graph/move-node ↔ graphNodeMove (an absent from_ref_id is empty); graph/delete-edge ↔ graphEdgeDelete only by endpoints", () => {
    expect(
      strutProposalToOutput(
        "graph/move-node",
        { ref_id: "n", edge_type: "PARENT_OF", direction: "reverse", to_ref_id: "p2" },
        "acme",
      ),
    ).toEqual({
      kind: "graphNodeMove",
      proposalId: "strut",
      payload: {
        workspaceId: "",
        workspaceSlug: "acme",
        ref_id: "n",
        edge_type: "PARENT_OF",
        from_ref_id: "",
        to_ref_id: "p2",
      },
      meta: { workspaceSlug: "acme" },
    });
    expect(
      strutProposalToOutput(
        "graph/delete-edge",
        { source_ref_id: "a", edge_type: "PARENT_OF", target_ref_id: "b" },
        "acme",
      ),
    ).toEqual({
      kind: "graphEdgeDelete",
      proposalId: "strut",
      payload: {
        workspaceId: "",
        workspaceSlug: "acme",
        edge_type: "PARENT_OF",
        source_ref_id: "a",
        target_ref_id: "b",
      },
      meta: { workspaceSlug: "acme" },
    });
    expect(strutProposalToOutput("graph/delete-edge", { edge_ref_id: "e1" })).toBeNull();
  });

  it("edit-node, delete-node and unknown steps have no hive body (the card draws them itself)", () => {
    expect(strutProposalToOutput("graph/edit-node", { ref_id: "n", node_data: { docs: "x" } })).toBeNull();
    expect(strutProposalToOutput("graph/delete-node", { ref_id: "n" })).toBeNull();
    expect(strutProposalToOutput("memory/remember", { text: "x" })).toBeNull();
    expect(strutProposalToOutput("graph/create-node", "not an object")).toBeNull();
  });

  it("labels each step for the card", () => {
    expect(strutProposalStepLabel("graph/create-node")).toBe("Proposed new graph node");
    expect(strutProposalStepLabel("graph/delete-node")).toBe("Proposed node delete");
    expect(strutProposalStepLabel("sphinx/send")).toBe("Proposed sphinx/send");
  });
});
