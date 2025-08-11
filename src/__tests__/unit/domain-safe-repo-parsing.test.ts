import { describe, test, expect } from "vitest";
import { 
  extractRepoNameFromUrl, 
  toDomainSafeName, 
  extractDomainSafeRepoName 
} from "@/utils/repositoryParser";

describe("Domain-Safe Repository Name Parsing", () => {
  describe("extractRepoNameFromUrl", () => {
    test("should extract repo name from GitHub HTTPS URLs", () => {
      expect(extractRepoNameFromUrl("https://github.com/user/my-awesome-project")).toBe("my-awesome-project");
      expect(extractRepoNameFromUrl("https://github.com/facebook/react")).toBe("react");
      expect(extractRepoNameFromUrl("https://github.com/microsoft/TypeScript")).toBe("TypeScript");
    });

    test("should extract repo name from GitHub HTTP URLs", () => {
      expect(extractRepoNameFromUrl("http://github.com/user/my-project")).toBe("my-project");
    });

    test("should extract repo name from GitHub URLs without protocol", () => {
      expect(extractRepoNameFromUrl("github.com/user/api_v2_backend")).toBe("api_v2_backend");
      expect(extractRepoNameFromUrl("github.com/org/react-component-library")).toBe("react-component-library");
    });

    test("should handle GitHub URLs with query parameters and fragments", () => {
      expect(extractRepoNameFromUrl("https://github.com/user/repo?tab=readme")).toBe("repo");
      expect(extractRepoNameFromUrl("https://github.com/user/repo#installation")).toBe("repo");
      expect(extractRepoNameFromUrl("https://github.com/user/repo?param=value#section")).toBe("repo");
    });

    test("should handle GitHub URLs with trailing slashes", () => {
      expect(extractRepoNameFromUrl("https://github.com/user/my-repo/")).toBe("my-repo");
      expect(extractRepoNameFromUrl("https://github.com/user/my-repo/tree/main")).toBe("my-repo");
    });

    test("should return input as-is if not a GitHub URL", () => {
      expect(extractRepoNameFromUrl("my-local-repo")).toBe("my-local-repo");
      expect(extractRepoNameFromUrl("simple-name")).toBe("simple-name");
    });

    test("should handle case-insensitive GitHub domain", () => {
      expect(extractRepoNameFromUrl("https://GITHUB.COM/user/repo")).toBe("repo");
      expect(extractRepoNameFromUrl("https://Github.com/user/repo")).toBe("repo");
    });
  });

  describe("toDomainSafeName", () => {
    test("should convert underscores to hyphens", () => {
      expect(toDomainSafeName("my_awesome_project")).toBe("my-awesome-project");
      expect(toDomainSafeName("api_v2_backend")).toBe("api-v2-backend");
      expect(toDomainSafeName("user_management_service")).toBe("user-management-service");
    });

    test("should convert dots to hyphens (prevent subdomains)", () => {
      expect(toDomainSafeName("api.v2.backend")).toBe("api-v2-backend");
      expect(toDomainSafeName("my.project.name")).toBe("my-project-name");
      expect(toDomainSafeName("backend.ai.core")).toBe("backend-ai-core");
    });

    test("should convert to lowercase", () => {
      expect(toDomainSafeName("MyAwesomeProject")).toBe("myawesomeproject");
      expect(toDomainSafeName("ReactComponentLibrary")).toBe("reactcomponentlibrary");
      expect(toDomainSafeName("API_V2_BACKEND")).toBe("api-v2-backend");
    });

    test("should handle mixed characters", () => {
      expect(toDomainSafeName("My_API.Project")).toBe("my-api-project");
      expect(toDomainSafeName("Backend.AI_Core")).toBe("backend-ai-core");
      expect(toDomainSafeName("User_Management.Service_V2")).toBe("user-management-service-v2");
    });

    test("should preserve existing hyphens", () => {
      expect(toDomainSafeName("my-awesome-project")).toBe("my-awesome-project");
      expect(toDomainSafeName("react-component-library")).toBe("react-component-library");
    });

    test("should handle numbers correctly", () => {
      expect(toDomainSafeName("api_v2")).toBe("api-v2");
      expect(toDomainSafeName("project123")).toBe("project123");
      expect(toDomainSafeName("My.API.V2_Backend")).toBe("my-api-v2-backend");
    });

    test("should handle edge cases", () => {
      expect(toDomainSafeName("")).toBe("");
      expect(toDomainSafeName("a")).toBe("a");
      expect(toDomainSafeName("_")).toBe("-");
      expect(toDomainSafeName(".")).toBe("-");
      expect(toDomainSafeName("_.")).toBe("--");
    });
  });

  describe("extractDomainSafeRepoName (composed function)", () => {
    test("should extract and convert GitHub URLs to domain-safe names", () => {
      expect(extractDomainSafeRepoName("https://github.com/user/My_Awesome_Project")).toBe("my-awesome-project");
      expect(extractDomainSafeRepoName("https://github.com/facebook/react")).toBe("react");
      expect(extractDomainSafeRepoName("https://github.com/microsoft/TypeScript")).toBe("typescript");
    });

    test("should handle URLs with dots and underscores", () => {
      expect(extractDomainSafeRepoName("https://github.com/user/api.v2_backend")).toBe("api-v2-backend");
      expect(extractDomainSafeRepoName("https://github.com/org/backend.ai_core")).toBe("backend-ai-core");
    });

    test("should handle non-URL inputs", () => {
      expect(extractDomainSafeRepoName("My_Local.Project")).toBe("my-local-project");
      expect(extractDomainSafeRepoName("simple_name")).toBe("simple-name");
    });

    test("should handle real-world GitHub repository examples", () => {
      // Real examples that might cause issues
      expect(extractDomainSafeRepoName("https://github.com/rails/rails")).toBe("rails");
      expect(extractDomainSafeRepoName("https://github.com/nodejs/node.js")).toBe("node-js");
      expect(extractDomainSafeRepoName("https://github.com/pytorch/pytorch")).toBe("pytorch");
      expect(extractDomainSafeRepoName("https://github.com/tensorflow/tensorflow.js")).toBe("tensorflow-js");
    });
  });

  describe("Domain compatibility verification", () => {
    test("should produce valid domain names", () => {
      const testCases = [
        "https://github.com/user/My_API.Project",
        "https://github.com/org/backend.ai_core",
        "https://github.com/team/user_management.service",
        "Complex_Project.Name_V2"
      ];

      testCases.forEach(input => {
        const result = extractDomainSafeRepoName(input);
        
        // Should not contain invalid domain characters
        expect(result).not.toMatch(/[_.]/);
        expect(result).not.toMatch(/[A-Z]/);
        expect(result).not.toMatch(/\s/);
        
        // Should be a valid subdomain for .sphinx.chat
        const fullDomain = `${result}.sphinx.chat`;
        expect(fullDomain).toMatch(/^[a-z0-9-]+\.sphinx\.chat$/);
      });
    });

    test("should not create subdomain issues", () => {
      // These would create problematic subdomains if dots weren't converted
      const problematicInputs = [
        "api.v2.backend",
        "my.project.name", 
        "backend.ai.core"
      ];

      problematicInputs.forEach(input => {
        const result = toDomainSafeName(input);
        const fullDomain = `${result}.sphinx.chat`;
        
        // Should have exactly 2 dots: projectname.sphinx.chat
        const dotCount = (fullDomain.match(/\./g) || []).length;
        expect(dotCount).toBe(2);
        
        // Should not contain dots in the subdomain part (before .sphinx.chat)
        const subdomain = result;
        expect(subdomain).not.toMatch(/\./);
      });
    });
  });
});