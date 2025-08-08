import { describe, it, expect } from "vitest";
import {
  parseRepositoryName,
  sanitizeWorkspaceName,
} from "@/utils/repositoryParser";

describe("repositoryParser", () => {
  describe("parseRepositoryName", () => {
    it("extracts repo name from full GitHub URLs (https/http, with query/fragment)", () => {
      expect(
        parseRepositoryName(
          "https://github.com/user/my-awesome-project?utm=1#readme",
        ),
      ).toBe("My Awesome Project");
      expect(
        parseRepositoryName("http://github.com/user/ReactComponentLibrary#v1"),
      ).toBe("React Component Library");
    });

    it("handles plain repo slugs with separators and cases", () => {
      expect(parseRepositoryName("api_v2_backend")).toBe("Api V2 Backend");
      expect(parseRepositoryName("data-science-toolkit")).toBe(
        "Data Science Toolkit",
      );
      expect(parseRepositoryName("ReactComponentLibrary")).toBe(
        "React Component Library",
      );
      expect(parseRepositoryName("reactJSONParser"))
        .toBe("React JSON Parser");
    });

    it("trims and collapses whitespace after transformations", () => {
      expect(parseRepositoryName("  my--awesome__project  ")).toBe(
        "My Awesome Project",
      );
    });

    it("handles numeric parts sensibly", () => {
      expect(parseRepositoryName("api-v2")).toBe("Api V2");
      expect(
        parseRepositoryName("https://github.com/u/repo_name_v2"),
      ).toBe("Repo Name V2");
    });

    it("returns empty string unchanged formatting when input is empty", () => {
      expect(parseRepositoryName("")).toBe("");
    });
  });

  describe("sanitizeWorkspaceName", () => {
    it("lowercases and replaces invalid characters with dashes", () => {
      expect(sanitizeWorkspaceName("My Awesome Project!@#"))
        .toBe("my-awesome-project");
    });

    it("collapses multiple dashes and trims leading/trailing dashes", () => {
      expect(sanitizeWorkspaceName("--My__Awesome--Project--"))
        .toBe("my-awesome-project");
      expect(sanitizeWorkspaceName("___proj___name___"))
        .toBe("proj-name");
    });

    it("allows alphanumeric and dashes only", () => {
      expect(sanitizeWorkspaceName("aB-09"))
        .toBe("ab-09");
    });
  });
});


