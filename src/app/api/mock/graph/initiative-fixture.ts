/**
 * Mock mode (`USE_MOCKS`): one planned initiative for `getInitiativeTree`,
 * whatever ref_id is asked for — two milestones, a brief, three features and
 * their stories and requirements, some still proposed.
 */

import type { InitiativeNodeType, InitiativeTreeData, InitiativeTreeNode } from "@/services/graph/workbench";

export function mockInitiativeTree(refId: string): Pick<InitiativeTreeData, "nodes" | "edges"> {
  const nodes: InitiativeTreeNode[] = [];
  const edges: InitiativeTreeData["edges"] = [];
  const add = (
    type: InitiativeNodeType,
    id: string,
    properties: Record<string, unknown>,
    parent?: string,
    edge?: string,
  ) => {
    nodes.push({ ref_id: id, type, properties: { created_by_kind: "human", ...properties } });
    if (parent && edge) edges.push({ source: parent, target: id, type: edge });
  };

  add("HiveInitiative", refId, { initiative_id: refId, name: "Self-serve onboarding", status: "ACTIVE" });
  add(
    "Brief",
    `${refId}-brief`,
    {
      brief_id: `${refId}-brief`,
      text: "New orgs stall before their first workspace; get them to a first task alone.",
    },
    refId,
    "HAS_BRIEF",
  );
  const milestones = [
    { id: `${refId}-m1`, name: "Sign-up to first workspace", sequence: 1 },
    { id: `${refId}-m2`, name: "First task without help", sequence: 2 },
  ];
  for (const m of milestones) {
    add(
      "HiveMilestone",
      m.id,
      { milestone_id: m.id, name: m.name, sequence: m.sequence, status: "NOT_STARTED" },
      refId,
      "HAS_MILESTONE",
    );
  }
  const features = [
    { m: milestones[0].id, name: "Guided workspace setup", reqs: ["accepted", "accepted", "proposed"] },
    { m: milestones[0].id, name: "Repo picker", reqs: ["accepted"] },
    { m: milestones[1].id, name: "Starter task templates", reqs: ["proposed", "proposed", "dropped"] },
  ];
  features.forEach((f, i) => {
    const fid = `${refId}-f${i + 1}`;
    add(
      "InitiativeFeature",
      fid,
      { feature_id: fid, name: f.name, status: "proposed", created_by_kind: "strut" },
      f.m,
      "HAS_FEATURE",
    );
    const sid = `${fid}-s1`;
    add(
      "UserStory",
      sid,
      { story_id: sid, text: `As a new admin I can finish "${f.name}" on my own.`, status: "proposed" },
      fid,
      "HAS_STORY",
    );
    f.reqs.forEach((status, j) => {
      const rid = `${sid}-r${j + 1}`;
      add(
        "Requirement",
        rid,
        { requirement_id: rid, text: `${f.name}: requirement ${j + 1}`, status },
        sid,
        "HAS_REQUIREMENT",
      );
    });
  });
  return { nodes, edges };
}
