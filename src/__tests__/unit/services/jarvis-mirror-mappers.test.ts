import { describe, it, expect } from "vitest";
import {
  featureToNode,
  taskToNode,
  chatMessageToNode,
  chatMessageName,
  taskEdge,
  chatMessageEdge,
  HIVE_FEATURE,
  HIVE_TASK,
  HIVE_CHAT_MESSAGE,
  EDGE_HAS_TASK,
  EDGE_HAS_MESSAGE,
} from "@/services/jarvis-mirror/mappers";

const AT = new Date("2026-01-02T03:04:05.000Z");

describe("jarvis-mirror mappers", () => {
  describe("featureToNode", () => {
    it("maps id -> feature_id (node_key field) and title -> name", () => {
      const node = featureToNode({
        id: "feat_1",
        title: "My Feature",
        status: "BACKLOG",
        priority: "LOW",
        brief: "a brief",
        workspaceId: "ws_1",
        createdAt: AT,
        updatedAt: AT,
      });
      expect(node.node_type).toBe(HIVE_FEATURE);
      expect(node.node_data.feature_id).toBe("feat_1");
      expect(node.node_data.name).toBe("My Feature");
      expect(node.node_data.brief).toBe("a brief");
      expect(node.node_data.updated_at).toBe(AT.toISOString());
    });

    it("omits null/undefined fields", () => {
      const node = featureToNode({ id: "f", title: "t", brief: null, requirements: undefined });
      expect("brief" in node.node_data).toBe(false);
      expect("requirements" in node.node_data).toBe(false);
      expect("assignee_id" in node.node_data).toBe(false);
    });
  });

  describe("taskToNode", () => {
    it("maps id -> task_id and includes feature_id when present", () => {
      const node = taskToNode({ id: "task_1", title: "Do it", featureId: "feat_1" });
      expect(node.node_type).toBe(HIVE_TASK);
      expect(node.node_data.task_id).toBe("task_1");
      expect(node.node_data.name).toBe("Do it");
      expect(node.node_data.feature_id).toBe("feat_1");
    });
  });

  describe("chatMessageToNode / chatMessageName", () => {
    it("builds a short role-prefixed name and keeps full message", () => {
      const m = { id: "m1", message: "Hello there friend", role: "USER" };
      expect(chatMessageName(m)).toBe("user: Hello there friend");
      const node = chatMessageToNode(m);
      expect(node.node_type).toBe(HIVE_CHAT_MESSAGE);
      expect(node.node_data.message_id).toBe("m1");
      expect(node.node_data.message).toBe("Hello there friend");
    });

    it("truncates the name snippet but not the message", () => {
      const long = "x".repeat(200);
      const m = { id: "m1", message: long, role: "ASSISTANT" };
      const name = chatMessageName(m);
      expect(name.length).toBeLessThan(long.length);
      expect(chatMessageToNode(m).node_data.message).toBe(long);
    });
  });

  describe("taskEdge", () => {
    it("returns HiveFeature -HAS_TASK-> HiveTask when task has a feature", () => {
      const edge = taskEdge({
        id: "task_1",
        title: "T",
        feature: { id: "feat_1", title: "F" },
      });
      expect(edge).not.toBeNull();
      expect(edge!.edge.edge_type).toBe(EDGE_HAS_TASK);
      expect(edge!.source).toEqual({
        node_type: HIVE_FEATURE,
        node_data: { feature_id: "feat_1", name: "F" },
      });
      expect(edge!.target).toEqual({
        node_type: HIVE_TASK,
        node_data: { task_id: "task_1", name: "T" },
      });
    });

    it("returns null when task has no feature", () => {
      expect(taskEdge({ id: "task_1", title: "T", feature: null })).toBeNull();
    });
  });

  describe("chatMessageEdge", () => {
    it("links to the task when message has a task parent", () => {
      const edge = chatMessageEdge({
        id: "m1",
        message: "hi",
        role: "USER",
        task: { id: "task_1", title: "T" },
      });
      expect(edge!.edge.edge_type).toBe(EDGE_HAS_MESSAGE);
      expect(edge!.source.node_type).toBe(HIVE_TASK);
      expect((edge!.source.node_data as { task_id: string }).task_id).toBe("task_1");
      expect(edge!.target.node_type).toBe(HIVE_CHAT_MESSAGE);
    });

    it("links to the feature when message has only a feature parent", () => {
      const edge = chatMessageEdge({
        id: "m1",
        message: "hi",
        role: "USER",
        feature: { id: "feat_1", title: "F" },
      });
      expect(edge!.source.node_type).toBe(HIVE_FEATURE);
      expect((edge!.source.node_data as { feature_id: string }).feature_id).toBe("feat_1");
    });

    it("returns null when message has no parent", () => {
      expect(chatMessageEdge({ id: "m1", message: "hi", role: "USER" })).toBeNull();
    });
  });
});
