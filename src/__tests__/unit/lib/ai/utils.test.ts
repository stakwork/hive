import { describe, it, expect } from "vitest";
import { parseOwnerRepo, buildFeatureContext } from "@/lib/ai/utils";

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
    it("should build complete context when all fields are populated", () => {
      const feature = {
        id: "feature-1",
        title: "User Authentication",
        brief: "Implement secure user authentication",
        personas: ["Developer", "End User"],
        requirements: "Must support OAuth 2.0",
        architecture: "Use JWT tokens for session management",
        userStories: [
          { title: "As a user, I want to log in securely" },
          { title: "As a developer, I want to integrate OAuth" }
        ],
        workspace: {
          description: "E-commerce platform"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result).toEqual({
        title: "User Authentication",
        brief: "Implement secure user authentication",
        workspaceDesc: "\n\nWorkspace Context: E-commerce platform",
        personasText: "\n\nTarget Personas:\n- Developer\n- End User",
        userStoriesText: "\n\nUser Stories:\n- As a user, I want to log in securely\n- As a developer, I want to integrate OAuth",
        requirementsText: "Must support OAuth 2.0",
        architectureText: "Use JWT tokens for session management"
      });
    });

    it("should handle null workspace description", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: null
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.workspaceDesc).toBe("");
    });

    it("should handle empty workspace description string", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: ""
        }
      };

      const result = buildFeatureContext(feature);

      // Empty string is falsy, so should return empty string (not include prefix)
      expect(result.workspaceDesc).toBe("");
    });

    it("should handle empty personas array", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.personasText).toBe("");
    });

    it("should format single persona as bullet list", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: ["Developer"],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.personasText).toBe("\n\nTarget Personas:\n- Developer");
    });

    it("should format multiple personas as bullet list", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: ["Developer", "Product Manager", "End User"],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.personasText).toBe(
        "\n\nTarget Personas:\n- Developer\n- Product Manager\n- End User"
      );
    });

    it("should handle empty user stories array", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.userStoriesText).toBe("");
    });

    it("should format single user story", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [
          { title: "As a user, I want to see my profile" }
        ],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.userStoriesText).toBe(
        "\n\nUser Stories:\n- As a user, I want to see my profile"
      );
    });

    it("should format multiple user stories", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [
          { title: "As a user, I want to log in" },
          { title: "As a user, I want to log out" },
          { title: "As an admin, I want to manage users" }
        ],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.userStoriesText).toBe(
        "\n\nUser Stories:\n- As a user, I want to log in\n- As a user, I want to log out\n- As an admin, I want to manage users"
      );
    });

    it("should handle null requirements", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.requirementsText).toBe("");
    });

    it("should handle null architecture", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "Test brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.architectureText).toBe("");
    });

    it("should preserve null brief value", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.brief).toBeNull();
    });

    it("should preserve non-null brief value", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: "This is a detailed feature brief",
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.brief).toBe("This is a detailed feature brief");
    });

    it("should pass through title unchanged", () => {
      const feature = {
        id: "feature-1",
        title: "Complex Feature Title with Special-Characters_123",
        brief: null,
        personas: [],
        requirements: null,
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.title).toBe("Complex Feature Title with Special-Characters_123");
    });

    it("should handle populated requirements text", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        personas: [],
        requirements: "Must be secure, scalable, and maintainable",
        architecture: null,
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.requirementsText).toBe("Must be secure, scalable, and maintainable");
    });

    it("should handle populated architecture text", () => {
      const feature = {
        id: "feature-1",
        title: "Test Feature",
        brief: null,
        personas: [],
        requirements: null,
        architecture: "Microservices architecture with API gateway",
        userStories: [],
        workspace: {
          description: "Test workspace"
        }
      };

      const result = buildFeatureContext(feature);

      expect(result.architectureText).toBe("Microservices architecture with API gateway");
    });
  });
});