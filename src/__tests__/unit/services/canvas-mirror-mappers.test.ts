import { describe, it, expect } from "vitest";
import {
  initiativeToNode,
  milestoneToNode,
  researchToNode,
  noteToNode,
  decisionToNode,
  initiativeMilestoneEdge,
  initiativeResearchEdge,
  milestoneResearchEdge,
  HIVE_INITIATIVE,
  HIVE_MILESTONE,
  HIVE_RESEARCH,
  HIVE_NOTE,
  HIVE_DECISION,
  EDGE_HAS_MILESTONE,
  EDGE_HAS_RESEARCH,
} from "@/services/jarvis-mirror/mappers";

const AT = new Date("2026-01-02T03:04:05.000Z");

describe("canvas-mirror node mappers", () => {
  describe("initiativeToNode", () => {
    it("maps id → initiative_id, name, status, dates", () => {
      const node = initiativeToNode({
        id: "init_1",
        name: "Q1 Goals",
        description: "desc",
        status: "ACTIVE",
        orgId: "org_1",
        assigneeId: "user_1",
        startDate: AT,
        targetDate: AT,
        completedAt: null,
        createdAt: AT,
        updatedAt: AT,
      });
      expect(node.node_type).toBe(HIVE_INITIATIVE);
      expect(node.node_data.initiative_id).toBe("init_1");
      expect(node.node_data.name).toBe("Q1 Goals");
      expect(node.node_data.status).toBe("ACTIVE");
      expect(node.node_data.org_id).toBe("org_1");
      expect(node.node_data.assignee_id).toBe("user_1");
      expect(node.node_data.start_date).toBe(AT.toISOString());
      expect(node.node_data.updated_at).toBe(AT.toISOString());
    });

    it("omits null/undefined fields (clean)", () => {
      const node = initiativeToNode({ id: "i1", name: "N", assigneeId: null });
      expect("assignee_id" in node.node_data).toBe(false);
      expect("completed_at" in node.node_data).toBe(false);
    });
  });

  describe("milestoneToNode", () => {
    it("maps id → milestone_id, name, initiative_id, sequence", () => {
      const node = milestoneToNode({
        id: "ms_1",
        name: "M1",
        status: "IN_PROGRESS",
        sequence: 3,
        initiativeId: "init_1",
        dueDate: AT,
        updatedAt: AT,
      });
      expect(node.node_type).toBe(HIVE_MILESTONE);
      expect(node.node_data.milestone_id).toBe("ms_1");
      expect(node.node_data.name).toBe("M1");
      expect(node.node_data.initiative_id).toBe("init_1");
      expect(node.node_data.sequence).toBe(3);
      expect(node.node_data.due_date).toBe(AT.toISOString());
    });
  });

  describe("researchToNode", () => {
    it("maps id → research_id, slug, title, content", () => {
      const node = researchToNode({
        id: "res_1",
        slug: "my-research",
        topic: "AI trends",
        title: "AI in 2026",
        summary: "A summary",
        content: "Long content",
        orgId: "org_1",
        initiativeId: "init_1",
        createdAt: AT,
        updatedAt: AT,
      });
      expect(node.node_type).toBe(HIVE_RESEARCH);
      expect(node.node_data.research_id).toBe("res_1");
      expect(node.node_data.name).toBe("AI in 2026");
      expect(node.node_data.slug).toBe("my-research");
      expect(node.node_data.topic).toBe("AI trends");
      expect(node.node_data.content).toBe("Long content");
      expect(node.node_data.initiative_id).toBe("init_1");
    });

    it("omits null content", () => {
      const node = researchToNode({ id: "r", slug: "s", topic: "t", title: "T", content: null });
      expect("content" in node.node_data).toBe(false);
    });
  });

  describe("noteToNode", () => {
    it("maps to HiveNote with note_id and text", () => {
      const node = noteToNode({ id: "note_1", text: "Remember this", category: "note", x: 10, y: 20 });
      expect(node.node_type).toBe(HIVE_NOTE);
      expect(node.node_data.note_id).toBe("note_1");
      expect(node.node_data.text).toBe("Remember this");
      expect(node.node_data.x).toBe(10);
      expect(node.node_data.y).toBe(20);
    });

    it("truncates name to 80 chars but keeps full text", () => {
      const longText = "x".repeat(200);
      const node = noteToNode({ id: "n", text: longText, category: "note" });
      expect(String(node.node_data.name).length).toBeLessThanOrEqual(80);
      expect(node.node_data.text).toBe(longText);
    });

    it("uses fallback name for empty text", () => {
      const node = noteToNode({ id: "n", text: "", category: "note" });
      expect(node.node_data.name).toBe("(note)");
    });
  });

  describe("decisionToNode", () => {
    it("maps to HiveDecision with decision_id", () => {
      const node = decisionToNode({ id: "dec_1", text: "We decided X", category: "decision" });
      expect(node.node_type).toBe(HIVE_DECISION);
      expect(node.node_data.decision_id).toBe("dec_1");
      expect(node.node_data.text).toBe("We decided X");
    });

    it("uses fallback name for empty text", () => {
      const node = decisionToNode({ id: "d", text: "", category: "decision" });
      expect(node.node_data.name).toBe("(decision)");
    });
  });
});

describe("canvas-mirror edge mappers", () => {
  const initiative = { id: "init_1", name: "My Initiative" };
  const milestone = { id: "ms_1", name: "Milestone 1" };
  const research = { id: "res_1", title: "Research Title", slug: "research-slug" };

  describe("initiativeMilestoneEdge", () => {
    it("produces HiveInitiative -HAS_MILESTONE-> HiveMilestone", () => {
      const edge = initiativeMilestoneEdge(initiative, milestone);
      expect(edge.edge.edge_type).toBe(EDGE_HAS_MILESTONE);
      expect(edge.source.node_type).toBe(HIVE_INITIATIVE);
      expect((edge.source.node_data as { initiative_id: string }).initiative_id).toBe("init_1");
      expect(edge.target.node_type).toBe(HIVE_MILESTONE);
      expect((edge.target.node_data as { milestone_id: string }).milestone_id).toBe("ms_1");
    });
  });

  describe("initiativeResearchEdge", () => {
    it("produces HiveInitiative -HAS_RESEARCH-> HiveResearch", () => {
      const edge = initiativeResearchEdge(initiative, research);
      expect(edge.edge.edge_type).toBe(EDGE_HAS_RESEARCH);
      expect(edge.source.node_type).toBe(HIVE_INITIATIVE);
      expect(edge.target.node_type).toBe(HIVE_RESEARCH);
      expect((edge.target.node_data as { research_id: string }).research_id).toBe("res_1");
      expect((edge.target.node_data as { slug: string }).slug).toBe("research-slug");
    });
  });

  describe("milestoneResearchEdge", () => {
    it("produces HiveMilestone -HAS_RESEARCH-> HiveResearch", () => {
      const edge = milestoneResearchEdge(milestone, research);
      expect(edge.edge.edge_type).toBe(EDGE_HAS_RESEARCH);
      expect(edge.source.node_type).toBe(HIVE_MILESTONE);
      expect((edge.source.node_data as { milestone_id: string }).milestone_id).toBe("ms_1");
      expect(edge.target.node_type).toBe(HIVE_RESEARCH);
    });
  });
});
