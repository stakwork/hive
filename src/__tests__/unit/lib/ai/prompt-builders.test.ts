import { describe, it, expect } from "vitest";
import { buildArchitecturePrompt } from "@/lib/ai/prompt-builders";
import { buildFeatureContext } from "@/lib/ai/utils";
import {
  createMinimalFeatureData,
  createCompleteFeatureData,
} from "@/__tests__/support/fixtures";

describe("buildArchitecturePrompt", () => {
  describe("Complete Context", () => {
    it("should include all context fields when fully populated", () => {
      const feature = createCompleteFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Payment Integration");
      expect(prompt).toContain("Add Stripe payment processing");
      expect(prompt).toContain("E-commerce platform");
      expect(prompt).toContain("Customer");
      expect(prompt).toContain("Admin");
      expect(prompt).toContain("Must support credit cards and ACH payments");
      expect(prompt).toContain("Customer can checkout with credit card");
    });

    it("should include existing architecture section when present", () => {
      const feature = createCompleteFeatureData({
        architecture: "Use Stripe SDK v3 with webhook integration",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Existing Architecture:");
      expect(prompt).toContain("Use Stripe SDK v3 with webhook integration");
    });

    it("should include enhancement instruction when existing architecture present", () => {
      const feature = createCompleteFeatureData({
        architecture: "Use Stripe SDK v3",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain(
        "Incorporate and enhance the existing architecture above."
      );
    });
  });

  describe("Minimal Context", () => {
    it("should handle minimal feature data gracefully", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Test Feature");
      expect(prompt).toContain("Generate COMPLETE architecture");
    });

    it("should not contain undefined or null string literals with minimal data", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("undefined");
      expect(prompt).not.toContain("null");
    });

    it("should omit existing architecture section when not present", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("Existing Architecture:");
    });

    it("should omit enhancement instruction when no existing architecture", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain(
        "Incorporate and enhance the existing architecture above."
      );
    });
  });

  describe("Conditional Sections", () => {
    it("should include brief when present", () => {
      const feature = createCompleteFeatureData({
        brief: "Add payment processing with Stripe",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Brief:");
      expect(prompt).toContain("Add payment processing with Stripe");
    });

    it("should omit brief section when null", () => {
      const feature = createMinimalFeatureData({ brief: null });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      const lines = prompt.split("\n");
      const hasBriefLine = lines.some((line) => line.startsWith("Brief:"));
      expect(hasBriefLine).toBe(false);
    });

    it("should include requirements section when present", () => {
      const feature = createCompleteFeatureData({
        requirements: "Must support credit cards and refunds",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Requirements:");
      expect(prompt).toContain("Must support credit cards and refunds");
    });

    it("should omit requirements section when empty", () => {
      const feature = createMinimalFeatureData({ requirements: null });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("Requirements:");
    });

    it("should include workspace context when present", () => {
      const feature = createCompleteFeatureData();
      feature.workspace.description = "SaaS subscription platform";
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Workspace Context:");
      expect(prompt).toContain("SaaS subscription platform");
    });

    it("should handle empty workspace description", () => {
      const feature = createMinimalFeatureData();
      feature.workspace.description = null;
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("Workspace Context:");
    });

    it("should include personas section when present", () => {
      const feature = createCompleteFeatureData({
        personas: ["Developer", "QA Engineer"],
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Target Personas:");
      expect(prompt).toContain("Developer");
      expect(prompt).toContain("QA Engineer");
    });

    it("should handle empty personas array", () => {
      const feature = createMinimalFeatureData({ personas: [] });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("Target Personas:");
    });

    it("should include user stories section when present", () => {
      const feature = createCompleteFeatureData({
        userStories: [
          { title: "Customer completes checkout" },
          { title: "Admin processes refund" },
        ],
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("User Stories:");
      expect(prompt).toContain("Customer completes checkout");
      expect(prompt).toContain("Admin processes refund");
    });

    it("should handle empty user stories array", () => {
      const feature = createMinimalFeatureData({ userStories: [] });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("User Stories:");
    });
  });

  describe("AI Instructions", () => {
    it("should specify 200-400 word requirement", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("200-400 words");
    });

    it("should request FULL final architecture", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("FULL final architecture");
    });

    it("should specify content requirements", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("system design, components, and technical approach");
    });

    it("should request COMPLETE architecture generation", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Generate COMPLETE architecture");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string architecture differently than null", () => {
      const feature = createMinimalFeatureData({ architecture: "" });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).not.toContain("Existing Architecture:");
    });

    it("should handle whitespace-only architecture", () => {
      const feature = createMinimalFeatureData({ architecture: "   " });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Existing Architecture:");
    });

    it("should handle very long architecture text", () => {
      const longArchitecture = "A".repeat(5000);
      const feature = createCompleteFeatureData({
        architecture: longArchitecture,
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain(longArchitecture);
      expect(prompt.length).toBeGreaterThan(5000);
    });

    it("should handle special characters in context fields", () => {
      const feature = createCompleteFeatureData({
        title: 'Feature with "quotes" and \'apostrophes\'',
        brief: "Brief with $pecial ch@rs & symbols!",
        requirements: "Requirements with <tags> and {braces}",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain('Feature with "quotes" and \'apostrophes\'');
      expect(prompt).toContain("Brief with $pecial ch@rs & symbols!");
      expect(prompt).toContain("Requirements with <tags> and {braces}");
    });

    it("should handle newlines and formatting in architecture text", () => {
      const feature = createCompleteFeatureData({
        architecture: "Line 1\nLine 2\n\nLine 3 with\ttabs",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Line 1\nLine 2\n\nLine 3 with\ttabs");
    });

    it("should handle unicode characters", () => {
      const feature = createCompleteFeatureData({
        title: "Feature with émojis 🚀 and unicode ñ",
        brief: "Support internationalization with 中文 and العربية",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Feature with émojis 🚀 and unicode ñ");
      expect(prompt).toContain("Support internationalization with 中文 and العربية");
    });
  });

  describe("Prompt Structure", () => {
    it("should start with generation instruction", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toMatch(/^Generate COMPLETE architecture/);
    });

    it("should include title immediately after instruction", () => {
      const feature = createCompleteFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      const lines = prompt.split("\n");
      const titleLineIndex = lines.findIndex((line) =>
        line.includes("Title:")
      );
      expect(titleLineIndex).toBeGreaterThan(0);
      expect(lines[titleLineIndex]).toContain("Payment Integration");
    });

    it("should properly format multiple context sections", () => {
      const feature = createCompleteFeatureData({
        brief: "Test brief",
        requirements: "Test requirements",
        architecture: "Test architecture",
      });
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt).toContain("Brief: Test brief");
      expect(prompt).toContain("Requirements:\nTest requirements");
      expect(prompt).toContain("Existing Architecture:\nTest architecture");
    });

    it("should return a string", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const result = buildArchitecturePrompt(context);

      expect(typeof result).toBe("string");
    });

    it("should not return an empty string", () => {
      const feature = createMinimalFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("Context Integration", () => {
    it("should work correctly with buildFeatureContext output", () => {
      const feature = createCompleteFeatureData();
      const context = buildFeatureContext(feature);
      const prompt = buildArchitecturePrompt(context);

      expect(context.title).toBe("Payment Integration");
      expect(prompt).toContain(context.title);
      expect(prompt).toContain(context.brief || "");
    });

    it("should handle all FeatureContext fields", () => {
      const feature = createCompleteFeatureData();
      const context = buildFeatureContext(feature);

      expect(context).toHaveProperty("title");
      expect(context).toHaveProperty("brief");
      expect(context).toHaveProperty("workspaceDesc");
      expect(context).toHaveProperty("personasText");
      expect(context).toHaveProperty("userStoriesText");
      expect(context).toHaveProperty("requirementsText");
      expect(context).toHaveProperty("architectureText");

      const prompt = buildArchitecturePrompt(context);
      expect(prompt).toContain(context.title);
    });
  });
});