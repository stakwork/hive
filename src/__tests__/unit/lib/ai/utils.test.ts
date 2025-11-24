import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseOwnerRepo, buildFeatureContext } from "@/lib/ai/utils";
import {
  createMinimalFeatureData,
  createCompleteFeatureData,
} from "@/__tests__/support/fixtures";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";

describe("ai/utils", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    // Default mock: return empty array for tasks
    (db.task.findMany as any).mockResolvedValue([]);
  });
  describe("parseOwnerRepo", () => {
    it("should parse HTTPS GitHub URL", async () => {
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
    it("should transform complete FeatureData to FeatureContext with all fields populated", async () => {
      const featureData = createCompleteFeatureData();

      const result = await buildFeatureContext(featureData);

      expect(result).toEqual({
        title: "Payment Integration",
        brief: "Add Stripe payment processing",
        workspaceDesc: "\n\nWorkspace Context: E-commerce platform for online retail",
        personasText: "\n\nTarget Personas:\n- Customer\n- Admin\n- Developer",
        userStoriesText: "\n\nUser Stories:\n- Customer can checkout with credit card\n- Admin can view payment history",
        tasksText: "",
        requirementsText: "Must support credit cards and ACH payments",
        architectureText: "Use Stripe SDK with webhook handlers",
      });
    });

    it("should format personas array as bulleted list with section header", async () => {
      const featureData = createMinimalFeatureData({
        personas: ["Product Manager", "Engineer", "Designer"],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toBe("\n\nTarget Personas:\n- Product Manager\n- Engineer\n- Designer");
    });

    it("should format user stories array as bulleted list with section header", async () => {
      const featureData = createMinimalFeatureData({
        userStories: [
          { title: "User can sign in with Google" },
          { title: "User can reset password via email" },
          { title: "User can enable two-factor authentication" },
        ],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe(
        "\n\nUser Stories:\n- User can sign in with Google\n- User can reset password via email\n- User can enable two-factor authentication"
      );
    });

    it("should extract workspace description with section header", async () => {
      const featureData = createMinimalFeatureData({
        workspace: {
          description: "Healthcare management system for clinics",
        },
      });

      const result = await buildFeatureContext(featureData);

      expect(result.workspaceDesc).toBe("\n\nWorkspace Context: Healthcare management system for clinics");
    });

    it("should handle empty personas array", async () => {
      const featureData = createMinimalFeatureData({
        brief: "Test brief",
        personas: [],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toBe("");
    });

    it("should handle empty user stories array", async () => {
      const featureData = createMinimalFeatureData({
        brief: "Test brief",
        personas: ["Developer"],
        userStories: [],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe("");
    });

    it("should handle null workspace description", async () => {
      const featureData = createMinimalFeatureData({
        workspace: {
          description: null,
        },
      });

      const result = await buildFeatureContext(featureData);

      expect(result.workspaceDesc).toBe("");
    });

    it("should handle null brief", async () => {
      const featureData = createMinimalFeatureData({
        brief: null,
        personas: ["Developer"],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.brief).toBeNull();
    });

    it("should handle null requirements with empty string fallback", async () => {
      const featureData = createMinimalFeatureData({
        requirements: null,
      });

      const result = await buildFeatureContext(featureData);

      expect(result.requirementsText).toBe("");
    });

    it("should handle null architecture with empty string fallback", async () => {
      const featureData = createMinimalFeatureData({
        architecture: null,
      });

      const result = await buildFeatureContext(featureData);

      expect(result.architectureText).toBe("");
    });

    it("should handle all optional fields missing or empty", async () => {
      const featureData = createMinimalFeatureData({
        title: "Minimal Feature",
      });

      const result = await buildFeatureContext(featureData);

      expect(result).toEqual({
        title: "Minimal Feature",
        brief: null,
        workspaceDesc: "",
        personasText: "",
        userStoriesText: "",
        tasksText: "",
        requirementsText: "",
        architectureText: "",
      });
    });

    it("should preserve title field exactly as provided", async () => {
      const featureData = createMinimalFeatureData({
        title: "Complex Feature: AI-Powered Recommendation Engine",
      });

      const result = await buildFeatureContext(featureData);

      expect(result.title).toBe("Complex Feature: AI-Powered Recommendation Engine");
    });

    it("should handle single persona correctly", async () => {
      const featureData = createMinimalFeatureData({
        personas: ["End User"],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toBe("\n\nTarget Personas:\n- End User");
    });

    it("should handle single user story correctly", async () => {
      const featureData = createMinimalFeatureData({
        userStories: [{ title: "User can export data as CSV" }],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe("\n\nUser Stories:\n- User can export data as CSV");
    });

    it("should pass through requirements text without modification", async () => {
      const requirementsText = "Must support OAuth 2.0\nMust handle rate limiting\nMust log all API calls";
      const featureData = createMinimalFeatureData({
        requirements: requirementsText,
      });

      const result = await buildFeatureContext(featureData);

      expect(result.requirementsText).toBe(requirementsText);
    });

    it("should pass through architecture text without modification", async () => {
      const architectureText = "Microservices architecture\nUse Redis for caching\nDeploy on Kubernetes";
      const featureData = createMinimalFeatureData({
        architecture: architectureText,
      });

      const result = await buildFeatureContext(featureData);

      expect(result.architectureText).toBe(architectureText);
    });

    it("should handle arrays with empty strings in personas", async () => {
      const featureData = createMinimalFeatureData({
        personas: ["Developer", "", "Designer", ""],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toBe("\n\nTarget Personas:\n- Developer\n- \n- Designer\n- ");
    });

    it("should handle arrays with empty strings in user stories", async () => {
      const featureData = createMinimalFeatureData({
        userStories: [
          { title: "Valid story" },
          { title: "" },
          { title: "Another valid story" },
        ],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe("\n\nUser Stories:\n- Valid story\n- \n- Another valid story");
    });

    it("should handle large personas array (10+ items)", async () => {
      const largePersonasArray = Array.from({ length: 15 }, (_, i) => `Persona ${i + 1}`);
      const featureData = createMinimalFeatureData({
        personas: largePersonasArray,
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toContain("Target Personas:");
      expect(result.personasText.split("\n").length).toBe(18); // 2 empty strings + header + 15 personas
      expect(result.personasText).toContain("- Persona 1");
      expect(result.personasText).toContain("- Persona 15");
    });

    it("should handle large user stories array (10+ items)", async () => {
      const largeStoriesArray = Array.from({ length: 20 }, (_, i) => ({
        title: `User story ${i + 1}`,
      }));
      const featureData = createMinimalFeatureData({
        userStories: largeStoriesArray,
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toContain("User Stories:");
      expect(result.userStoriesText.split("\n").length).toBe(23); // 2 empty strings + header + 20 stories
      expect(result.userStoriesText).toContain("- User story 1");
      expect(result.userStoriesText).toContain("- User story 20");
    });

    it("should handle arrays with whitespace-only strings in personas", async () => {
      const featureData = createMinimalFeatureData({
        personas: ["Developer", "   ", "Designer", "\t\n"],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toBe("\n\nTarget Personas:\n- Developer\n-    \n- Designer\n- \t\n");
    });

    it("should handle arrays with whitespace-only strings in user stories", async () => {
      const featureData = createMinimalFeatureData({
        userStories: [
          { title: "Valid story" },
          { title: "  " },
          { title: "\t" },
        ],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe("\n\nUser Stories:\n- Valid story\n-   \n- \t");
    });

    it("should not mutate the input FeatureData object", async () => {
      const originalPersonas = ["Developer", "Designer"];
      const originalStories = [{ title: "Story 1" }, { title: "Story 2" }];
      const featureData = createMinimalFeatureData({
        personas: originalPersonas,
        userStories: originalStories,
        workspace: { description: "Original description" },
      });

      const personasBeforeCall = [...featureData.personas];
      const storiesBeforeCall = [...featureData.userStories];
      const workspaceDescBeforeCall = featureData.workspace.description;

      buildFeatureContext(featureData);

      // Verify no mutation occurred
      expect(featureData.personas).toEqual(personasBeforeCall);
      expect(featureData.userStories).toEqual(storiesBeforeCall);
      expect(featureData.workspace.description).toBe(workspaceDescBeforeCall);
      expect(featureData.personas).toBe(originalPersonas); // Same reference
      expect(featureData.userStories).toBe(originalStories); // Same reference
    });

    it("should handle mixed scenarios with some null fields and some populated arrays", async () => {
      const featureData = createMinimalFeatureData({
        title: "Mixed Feature",
        brief: "Brief description",
        personas: ["User", "Admin"],
        requirements: null,
        architecture: "Architecture details",
        userStories: [],
        workspace: { description: null },
      });

      const result = await buildFeatureContext(featureData);

      expect(result.title).toBe("Mixed Feature");
      expect(result.brief).toBe("Brief description");
      expect(result.personasText).toBe("\n\nTarget Personas:\n- User\n- Admin");
      expect(result.requirementsText).toBe("");
      expect(result.architectureText).toBe("Architecture details");
      expect(result.userStoriesText).toBe("");
      expect(result.workspaceDesc).toBe("");
    });

    it("should handle personas array with special characters", async () => {
      const featureData = createMinimalFeatureData({
        personas: ["Developer (Senior)", "Product Manager @ Company", "Designer/UX Lead"],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.personasText).toBe(
        "\n\nTarget Personas:\n- Developer (Senior)\n- Product Manager @ Company\n- Designer/UX Lead"
      );
    });

    it("should handle user stories with special characters and formatting", async () => {
      const featureData = createMinimalFeatureData({
        userStories: [
          { title: "User can: authenticate via OAuth 2.0" },
          { title: "Admin can [manage] user permissions" },
          { title: "User can export data (CSV/JSON format)" },
        ],
      });

      const result = await buildFeatureContext(featureData);

      expect(result.userStoriesText).toBe(
        "\n\nUser Stories:\n- User can: authenticate via OAuth 2.0\n- Admin can [manage] user permissions\n- User can export data (CSV/JSON format)"
      );
    });

    it("should handle very long workspace description", async () => {
      const longDescription = "A".repeat(1000);
      const featureData = createMinimalFeatureData({
        workspace: { description: longDescription },
      });

      const result = await buildFeatureContext(featureData);

      expect(result.workspaceDesc).toBe(`\n\nWorkspace Context: ${longDescription}`);
      expect(result.workspaceDesc.length).toBe(longDescription.length + 21); // +21 for prefix
    });

    it("should handle all fields populated with maximum data", async () => {
      const featureData = createMinimalFeatureData({
        title: "Complex Feature Title",
        brief: "Detailed feature brief",
        personas: ["Persona 1", "Persona 2", "Persona 3", "Persona 4"],
        requirements: "Requirement 1\nRequirement 2\nRequirement 3",
        architecture: "Architecture Layer 1\nArchitecture Layer 2",
        userStories: [
          { title: "Story 1" },
          { title: "Story 2" },
          { title: "Story 3" },
          { title: "Story 4" },
          { title: "Story 5" },
        ],
        workspace: { description: "Comprehensive workspace description" },
      });

      const result = await buildFeatureContext(featureData);

      expect(result.title).toBe("Complex Feature Title");
      expect(result.brief).toBe("Detailed feature brief");
      expect(result.personasText).toContain("Persona 1");
      expect(result.personasText).toContain("Persona 4");
      expect(result.personasText.split("\n").length).toBe(7); // 2 empty strings + header + 4 personas
      expect(result.requirementsText).toContain("Requirement 1");
      expect(result.architectureText).toContain("Architecture Layer 1");
      expect(result.userStoriesText).toContain("Story 1");
      expect(result.userStoriesText).toContain("Story 5");
      expect(result.userStoriesText.split("\n").length).toBe(8); // 2 empty strings + header + 5 stories
      expect(result.workspaceDesc).toBe("\n\nWorkspace Context: Comprehensive workspace description");
    });

    it("should include tasksText when tasks exist for the feature", async () => {
      const featureData = createMinimalFeatureData({
        id: "feature-123",
      });

      // Mock db.task.findMany to return some tasks
      (db.task.findMany as any).mockResolvedValue([
        { title: "Setup database", status: "DONE", priority: "HIGH" },
        { title: "Create API endpoints", status: "IN_PROGRESS", priority: "MEDIUM" },
        { title: "Write tests", status: "TODO", priority: "LOW" },
      ]);

      const result = await buildFeatureContext(featureData);

      expect(result.tasksText).toBe(
        "\n\nExisting Tasks:\n- Setup database (DONE, HIGH)\n- Create API endpoints (IN_PROGRESS)\n- Write tests (TODO, LOW)"
      );
      expect(db.task.findMany).toHaveBeenCalledWith({
        where: { featureId: "feature-123", deleted: false },
        select: { title: true, description: true, status: true, priority: true },
      });
    });

    it("should handle empty tasksText when no tasks exist for the feature", async () => {
      const featureData = createMinimalFeatureData({
        id: "feature-456",
      });

      // Mock returns empty array (default from beforeEach)
      const result = await buildFeatureContext(featureData);

      expect(result.tasksText).toBe("");
    });

    it("should omit priority from tasksText when priority is MEDIUM", async () => {
      const featureData = createMinimalFeatureData({
        id: "feature-789",
      });

      (db.task.findMany as any).mockResolvedValue([
        { title: "Medium priority task", status: "TODO", priority: "MEDIUM" },
      ]);

      const result = await buildFeatureContext(featureData);

      expect(result.tasksText).toBe("\n\nExisting Tasks:\n- Medium priority task (TODO)");
      expect(result.tasksText).not.toContain("MEDIUM");
    });

    it("should produce consistent formatting across multiple calls with same input", async () => {
      const featureData = createMinimalFeatureData({
        personas: ["Developer", "Designer"],
        userStories: [{ title: "Story 1" }],
      });

      const result1 = await buildFeatureContext(featureData);
      const result2 = await buildFeatureContext(featureData);
      const result3 = await buildFeatureContext(featureData);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1.personasText).toBe(result2.personasText);
      expect(result1.userStoriesText).toBe(result2.userStoriesText);
    });
  });
});