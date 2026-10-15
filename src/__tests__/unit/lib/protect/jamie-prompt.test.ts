import { describe, expect, it } from "vitest";
import { buildProtectJamieSeed, chooseProtectJamieTool } from "@/lib/protect/jamie-prompt";
import type { ProtectFinding } from "@/types/protect";

function finding(overrides: Partial<ProtectFinding> = {}): ProtectFinding {
  return {
    ref_id: "ref-1",
    node_key: "key",
    id: "key",
    category: "bug",
    severity: "low",
    area: "auth",
    file: "src/login.ts",
    line: 12,
    title: "Rename unused variable",
    description: "Mechanical rename",
    evidence: "const unused = 1",
    recommendation: "Remove it",
    verification: "reported",
    status: "open",
    repositoryUrl: "https://github.com/acme/hive",
    ...overrides,
  };
}

describe("chooseProtectJamieTool", () => {
  it("seeds start_job for a small single-file fix", () => {
    expect(chooseProtectJamieTool(finding())).toBe("start_job");
  });

  it("seeds discuss for multi-file or ambiguous findings", () => {
    expect(
      chooseProtectJamieTool(
        finding({
          description: "Needs an architecture change across files",
          recommendation: "Redesign the auth module",
        }),
      ),
    ).toBe("discuss");
  });

  it("seeds discuss when the finding names no repository", () => {
    expect(chooseProtectJamieTool(finding({ repositoryUrl: "" }))).toBe("discuss");
  });
});

describe("buildProtectJamieSeed", () => {
  it("redacts secret-category evidence", () => {
    const seed = buildProtectJamieSeed(
      finding({ category: "secret", evidence: "sk-live-secret" }),
      "discuss",
      "acme-hive",
    );
    expect(seed).not.toContain("sk-live-secret");
    expect(seed).toContain("redacted");
    expect(seed).toContain("multi-file or ambiguous");
  });

  it("tells a job to take the workspace and name the repository in its prompt", () => {
    const seed = buildProtectJamieSeed(finding(), "start_job", "acme-hive");
    expect(seed).toContain("Workspace: acme-hive");
    expect(seed).toContain("Repository: https://github.com/acme/hive");
    expect(seed).toContain("start_job");
    expect(seed).toContain('workspace "acme-hive"');
    expect(seed).toContain("name the repository https://github.com/acme/hive");
  });
});
