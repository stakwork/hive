import { describe, test, expect } from "vitest";

describe("Repository Name Regex Parsing", () => {
  const parseRepositoryName = (repoName: string): string => {
    const urlMatch = repoName.match(/github\.com\/[^/]+\/([^/?#]+)/i);
    let parsedName = repoName;
    if (urlMatch) {
      parsedName = urlMatch[1];
    }
    parsedName = parsedName
      .replace(/[-_]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (l) => l.toUpperCase());
    return parsedName;
  };

  test("should extract repo name from GitHub URL", () => {
    expect(
      parseRepositoryName("https://github.com/user/my-awesome-project"),
    ).toBe("My Awesome Project");
    expect(parseRepositoryName("github.com/user/api_v2_backend")).toBe(
      "Api V2 Backend",
    );
    expect(
      parseRepositoryName("https://github.com/user/ReactComponentLibrary"),
    ).toBe("React Component Library");
  });

  test("should parse simple repo names", () => {
    expect(parseRepositoryName("my-awesome-project")).toBe(
      "My Awesome Project",
    );
    expect(parseRepositoryName("api_v2_backend")).toBe("Api V2 Backend");
    expect(parseRepositoryName("ReactComponentLibrary")).toBe(
      "React Component Library",
    );
    expect(parseRepositoryName("data-science-toolkit")).toBe(
      "Data Science Toolkit",
    );
  });
});
