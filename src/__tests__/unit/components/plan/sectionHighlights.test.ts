import { describe, it, expect } from "vitest";
import { computeSectionHighlights } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import type { FeatureDetail } from "@/types/roadmap";

function mockFeature(overrides: Partial<FeatureDetail> = {}): FeatureDetail {
  return {
    id: "feat-1",
    title: "Test",
    brief: null,
    requirements: null,
    architecture: null,
    personas: null,
    diagramUrl: null,
    diagramS3Key: null,
    status: "DRAFT",
    priority: null,
    workflowStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignee: null,
    userStories: [],
    phases: [],
    ...overrides,
  } as FeatureDetail;
}

describe("computeSectionHighlights", () => {
  describe('type: "new" highlight', () => {
    it("should produce 'new' highlight when a section goes from null to having content", () => {
      const prev = mockFeature({ brief: null });
      const next = mockFeature({ brief: "This is new content" });

      const result = computeSectionHighlights(prev, next);

      expect(result?.brief).toEqual({ type: "new" });
    });

    it("should not produce any highlights when nextVal is null", () => {
      const prev = mockFeature({ brief: null });
      const next = mockFeature({ brief: null });

      const result = computeSectionHighlights(prev, next);

      expect(result).toBeNull();
    });
  });

  describe('type: "diff" highlight', () => {
    it("should produce 'diff' highlight when content changes", () => {
      const prev = mockFeature({ brief: "Hello world" });
      const next = mockFeature({ brief: "Hello beautiful world" });

      const result = computeSectionHighlights(prev, next);

      expect(result?.brief?.type).toBe("diff");
      if (result?.brief?.type === "diff") {
        expect(result.brief.tokens.length).toBeGreaterThan(0);
      }
    });

    it("should not produce highlights when values are identical", () => {
      const prev = mockFeature({ brief: "Hello world" });
      const next = mockFeature({ brief: "Hello world" });

      const result = computeSectionHighlights(prev, next);

      expect(result).toBeNull();
    });
  });

  describe("diff token details", () => {
    it("should mark added words as isNew: true", () => {
      const prev = mockFeature({ brief: "Hello world" });
      const next = mockFeature({ brief: "Hello beautiful world" });

      const result = computeSectionHighlights(prev, next);
      expect(result?.brief?.type).toBe("diff");
      if (result?.brief?.type !== "diff") return;

      const { tokens } = result.brief;
      expect(tokens.find((t) => t.word === "beautiful")?.isNew).toBe(true);
      expect(tokens.find((t) => t.word === "Hello")?.isNew).toBe(false);
      expect(tokens.find((t) => t.word === "world")?.isNew).toBe(false);
    });

    it("should exclude removed words from tokens", () => {
      const prev = mockFeature({ brief: "Hello old world" });
      const next = mockFeature({ brief: "Hello new world" });

      const result = computeSectionHighlights(prev, next);
      expect(result?.brief?.type).toBe("diff");
      if (result?.brief?.type !== "diff") return;

      const { tokens } = result.brief;
      expect(tokens.find((t) => t.word === "old")).toBeUndefined();
      expect(tokens.find((t) => t.word === "new")?.isNew).toBe(true);
    });

    it("should include whitespace tokens", () => {
      const prev = mockFeature({ brief: "Hello world" });
      const next = mockFeature({ brief: "Hello beautiful world" });

      const result = computeSectionHighlights(prev, next);
      expect(result?.brief?.type).toBe("diff");
      if (result?.brief?.type !== "diff") return;

      const whitespaceTokens = result.brief.tokens.filter((t) => /^\s+$/.test(t.word));
      expect(whitespaceTokens.length).toBeGreaterThan(0);
    });
  });

  describe("user stories section", () => {
    it("should detect new user stories", () => {
      const prev = mockFeature({ userStories: [] });
      const next = mockFeature({
        userStories: [{ id: "s1", title: "As a user, I want to log in", order: 0, completed: false, createdAt: new Date(), updatedAt: new Date() }],
      } as Partial<FeatureDetail>);

      const result = computeSectionHighlights(prev, next);

      expect(result?.["user-stories"]).toEqual({ type: "new" });
    });

    it("should detect changed user stories", () => {
      const prev = mockFeature({
        userStories: [{ id: "s1", title: "Story A", order: 0, completed: false, createdAt: new Date(), updatedAt: new Date() }],
      } as Partial<FeatureDetail>);
      const next = mockFeature({
        userStories: [{ id: "s1", title: "Story B", order: 0, completed: false, createdAt: new Date(), updatedAt: new Date() }],
      } as Partial<FeatureDetail>);

      const result = computeSectionHighlights(prev, next);

      expect(result?.["user-stories"]?.type).toBe("diff");
    });
  });

  describe("multiple sections", () => {
    it("should detect highlights across multiple sections at once", () => {
      const prev = mockFeature({ brief: null, requirements: "Old reqs" });
      const next = mockFeature({ brief: "New brief", requirements: "Updated reqs" });

      const result = computeSectionHighlights(prev, next);

      expect(result?.brief).toEqual({ type: "new" });
      expect(result?.requirements?.type).toBe("diff");
    });
  });
});
