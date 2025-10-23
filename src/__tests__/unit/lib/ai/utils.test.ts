import { describe, it, expect } from "vitest";
import { buildFeatureContext } from "@/lib/ai/utils";
import {
  createMinimalFeatureData,
  createCompleteFeatureData,
} from "@/__tests__/support/fixtures";

describe("utils", () => {
  describe("buildFeatureContext", () => {
    it("should transform complete FeatureData to FeatureContext with all fields populated", () => {
      const featureData = createCompleteFeatureData();
      const result = buildFeatureContext(featureData);
      expect(result).toEqual({
        title: "Payment Integration",
        brief: "Add Stripe payment processing",
        workspaceDesc: "\n\nWorkspace Context: E-commerce platform for online retail",
        personasText: "\n\nTarget Personas:\n- Customer\n- Admin\n- Developer",
        userStoriesText: "\n\nUser Stories:\n- Customer can checkout with credit card\n- Admin can view payment history",
        requirementsText: "Must support credit cards and ACH payments",
        architectureText: "Use Stripe SDK with webhook handlers",
      });
    });

    it("should handle empty featureData", () => {
      const featureData = createMinimalFeatureData({ workspace: { description: "" } });
      const result = buildFeatureContext(featureData);
      expect(result).toEqual({
        title: "",
        brief: null,
        workspaceDesc: "",
        personasText: "",
        userStoriesText: "",
        requirementsText: "",
        architectureText: "",
      });
    });

    it("should handle special characters in brief", () => {
      const featureData = createMinimalFeatureData({
        brief: "Special chars: @#$%^&*",
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.brief).toBe("Special chars: @#$%^&*");
    });

    it("should handle null or undefined fields", () => {
      const featureData = createMinimalFeatureData({
        title: "null",
        brief: undefined,
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.title).toBeNull();
      expect(result.brief).toBeUndefined();
    });

    it("should handle invalid input types gracefully", () => {
      const invalidData = { personas: 123 };
      expect(() => buildFeatureContext(invalidData)).toThrow("Cannot read properties of undefined (reading 'description')");
    });

    it("should format personas array as bulleted list with section header", () => {
      const featureData = createMinimalFeatureData({
        personas: ["Product Manager", "Engineer", "Designer"],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.personasText).toBe("\n\nTarget Personas:\n- Product Manager\n- Engineer\n- Designer");
    });

    it("should format user stories array as bulleted list with section header", () => {
      const featureData = createMinimalFeatureData({
        userStories: [
          { title: "User can sign in with Google" },
          { title: "User can reset password via email" },
          { title: "User can enable two-factor authentication" },
        ],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.userStoriesText).toBe(
        "\n\nUser Stories:\n- User can sign in with Google\n- User can reset password via email\n- User can enable two-factor authentication"
      );
    });

    it("should extract workspace description with section header", () => {
      const featureData = createMinimalFeatureData({
        workspace: { description: "Healthcare management system for clinics" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.workspaceDesc).toBe("\n\nWorkspace Context: Healthcare management system for clinics");
    });

    it("should handle empty personas array", () => {
      const featureData = createMinimalFeatureData({
        brief: "Test brief",
        personas: [],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.personasText).toBe("");
    });

    it("should handle empty user stories array", () => {
      const featureData = createMinimalFeatureData({
        brief: "Test brief",
        personas: ["Developer"],
        userStories: [],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.userStoriesText).toBe("");
    });

    it("should handle null workspace description", () => {
      const featureData = createMinimalFeatureData({
        workspace: { description: null },
      });
      const result = buildFeatureContext(featureData);
      expect(result.workspaceDesc).toBe("");
    });

    it("should handle null brief", () => {
      const featureData = createMinimalFeatureData({
        brief: null,
        personas: ["Developer"],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.brief).toBeNull();
    });

    it("should handle null requirements with empty string fallback", () => {
      const featureData = createMinimalFeatureData({
        requirements: null,
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.requirementsText).toBe("");
    });

    it("should handle null architecture with empty string fallback", () => {
      const featureData = createMinimalFeatureData({
        architecture: null,
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.architectureText).toBe("");
    });

    it("should handle all optional fields missing or empty", () => {
      const featureData = createMinimalFeatureData({
        title: "Minimal Feature",
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result).toEqual({
        title: "Minimal Feature",
        brief: null,
        workspaceDesc: "",
        personasText: "",
        userStoriesText: "",
        requirementsText: "",
        architectureText: "",
      });
    });

    it("should preserve title field exactly as provided", () => {
      const featureData = createMinimalFeatureData({
        title: "Complex Feature: AI-Powered Recommendation Engine",
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.title).toBe("Complex Feature: AI-Powered Recommendation Engine");
    });

    it("should handle single persona correctly", () => {
      const featureData = createMinimalFeatureData({
        personas: ["End User"],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.personasText).toBe("\n\nTarget Personas:\n- End User");
    });

    it("should handle single user story correctly", () => {
      const featureData = createMinimalFeatureData({
        userStories: [{ title: "User can export data as CSV" }],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.userStoriesText).toBe("\n\nUser Stories:\n- User can export data as CSV");
    });

    it("should pass through requirements text without modification", () => {
      const requirementsText = "Must support OAuth 2.0\nMust handle rate limiting\nMust log all API calls";
      const featureData = createMinimalFeatureData({
        requirements: requirementsText,
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.requirementsText).toBe(requirementsText);
    });

    it("should pass through architecture text without modification", () => {
      const architectureText = "Microservices architecture\nUse Redis for caching\nDeploy on Kubernetes";
      const featureData = createMinimalFeatureData({
        architecture: architectureText,
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.architectureText).toBe(architectureText);
    });

    it("should not mutate input featureData", () => {
      const featureData = createMinimalFeatureData({
        title: "Test Title",
        workspace: { description: "" },
      });
      const copy = { ...featureData, workspace: { ...featureData.workspace } };
      buildFeatureContext(featureData);
      expect(featureData).toEqual(copy);
    });

    it("should handle arrays with empty strings in personas", () => {
      const featureData = createMinimalFeatureData({
        personas: ["Developer", "", "Designer"],
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.personasText).toBe("\n\nTarget Personas:\n- Developer\n- \n- Designer");
    });

    it("should handle large personas array", () => {
      const largeArray = Array(15).fill("Persona");
      const featureData = createMinimalFeatureData({
        personas: largeArray,
        workspace: { description: "" },
      });
      const result = buildFeatureContext(featureData);
      expect(result.personasText).toContain("Persona");
      expect(result.personasText.split("\n").length).toBe(18);
    });
  });
});