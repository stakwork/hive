import { describe, it, expect } from "vitest";
import { parseOwnerRepo, buildFeatureContext } from "@/lib/ai/utils";
import {
  createMinimalFeatureData,
  createCompleteFeatureData,
} from "@/__tests__/support/fixtures";

describe("ai/utils", () => {
  describe("parseOwnerRepo", () => {
    it("should parse HTTPS GitHub URL", () => {
      const result = parseOwnerRepo("https://github.com/owner/repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse HTTPS GitHub URL with .git suffix", () => {
      const result = parseOwnerRepo("https://github.com/owner/repo.git");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse SSH GitHub URL", () => {
      const result = parseOwnerRepo("git@github.com:owner/repo.git");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse SSH GitHub URL without .git suffix", () => {
      const result = parseOwnerRepo("git@github.com:owner/repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse shorthand format", () => {
      const result = parseOwnerRepo("owner/repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should handle URLs with hyphens in owner", () => {
      const result = parseOwnerRepo("https://github.com/my-org/repo");

      expect(result).toEqual({
        owner: "my-org",
        repo: "repo",
      });
    });

    it("should handle URLs with hyphens in repo", () => {
      const result = parseOwnerRepo("https://github.com/owner/my-repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "my-repo",
      });
    });

    it("should handle URLs with numbers", () => {
      const result = parseOwnerRepo("https://github.com/owner123/repo456");

      expect(result).toEqual({
        owner: "owner123",
        repo: "repo456",
      });
    });

    it("should handle URLs with underscores", () => {
      const result = parseOwnerRepo("https://github.com/my_org/my_repo");

      expect(result).toEqual({
        owner: "my_org",
        repo: "my_repo",
      });
    });

    it("should throw error for invalid format", () => {
      expect(() => parseOwnerRepo("invalid")).toThrow("Invalid repository URL format");
    });

    it("should throw error for empty string", () => {
      expect(() => parseOwnerRepo("")).toThrow("Invalid repository URL format");
    });

    it("should throw error for malformed URL", () => {
      expect(() => parseOwnerRepo("https://github.com/owner")).toThrow("Invalid repository URL format");
    });

    it("should throw error for non-GitHub URL", () => {
      expect(() => parseOwnerRepo("https://gitlab.com/owner/repo")).toThrow("Invalid repository URL format");
    });

    it("should throw error for URL with too many slashes", () => {
      expect(() => parseOwnerRepo("https://github.com/owner/repo/extra")).toThrow("Invalid repository URL format");
    });

    it("should handle case sensitivity correctly", () => {
      const result = parseOwnerRepo("https://github.com/MyOrg/MyRepo");

      expect(result).toEqual({
        owner: "MyOrg",
        repo: "MyRepo",
      });
    });
  });

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

    it("should format personas array as bulleted list with section header", () => {
      const featureData = createMinimalFeatureData({
        personas: ["Product Manager", "Engineer", "Designer"],
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
      });

      const result = buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe(
        "\n\nUser Stories:\n- User can sign in with Google\n- User can reset password via email\n- User can enable two-factor authentication"
      );
    });

    it("should extract workspace description with section header", () => {
      const featureData = createMinimalFeatureData({
        workspace: {
          description: "Healthcare management system for clinics",
        },
      });

      const result = buildFeatureContext(featureData);

      expect(result.workspaceDesc).toBe("\n\nWorkspace Context: Healthcare management system for clinics");
    });

    it("should handle empty personas array", () => {
      const featureData = createMinimalFeatureData({
        brief: "Test brief",
        personas: [],
      });

      const result = buildFeatureContext(featureData);

      expect(result.personasText).toBe("");
    });

    it("should handle empty user stories array", () => {
      const featureData = createMinimalFeatureData({
        brief: "Test brief",
        personas: ["Developer"],
        userStories: [],
      });

      const result = buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe("");
    });

    it("should handle null workspace description", () => {
      const featureData = createMinimalFeatureData({
        workspace: {
          description: null,
        },
      });

      const result = buildFeatureContext(featureData);

      expect(result.workspaceDesc).toBe("");
    });

    it("should handle null brief", () => {
      const featureData = createMinimalFeatureData({
        brief: null,
        personas: ["Developer"],
      });

      const result = buildFeatureContext(featureData);

      expect(result.brief).toBeNull();
    });

    it("should handle null requirements with empty string fallback", () => {
      const featureData = createMinimalFeatureData({
        requirements: null,
      });

      const result = buildFeatureContext(featureData);

      expect(result.requirementsText).toBe("");
    });

    it("should handle null architecture with empty string fallback", () => {
      const featureData = createMinimalFeatureData({
        architecture: null,
      });

      const result = buildFeatureContext(featureData);

      expect(result.architectureText).toBe("");
    });

    it("should handle all optional fields missing or empty", () => {
      const featureData = createMinimalFeatureData({
        title: "Minimal Feature",
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
      });

      const result = buildFeatureContext(featureData);

      expect(result.title).toBe("Complex Feature: AI-Powered Recommendation Engine");
    });

    it("should handle single persona correctly", () => {
      const featureData = createMinimalFeatureData({
        personas: ["End User"],
      });

      const result = buildFeatureContext(featureData);

      expect(result.personasText).toBe("\n\nTarget Personas:\n- End User");
    });

    it("should handle single user story correctly", () => {
      const featureData = createMinimalFeatureData({
        userStories: [{ title: "User can export data as CSV" }],
      });

      const result = buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe("\n\nUser Stories:\n- User can export data as CSV");
    });

    it("should pass through requirements text without modification", () => {
      const requirementsText = "Must support OAuth 2.0\nMust handle rate limiting\nMust log all API calls";
      const featureData = createMinimalFeatureData({
        requirements: requirementsText,
      });

      const result = buildFeatureContext(featureData);

      expect(result.requirementsText).toBe(requirementsText);
    });

    it("should pass through architecture text without modification", () => {
      const architectureText = "Microservices architecture\nUse Redis for caching\nDeploy on Kubernetes";
      const featureData = createMinimalFeatureData({
        architecture: architectureText,
      });

      const result = buildFeatureContext(featureData);

      expect(result.architectureText).toBe(architectureText);
    });
  });
});