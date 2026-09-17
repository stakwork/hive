import { describe, expect, it, vi } from "vitest";
import { buildProtectJamieSeed, chooseProtectJamieTool } from "@/lib/protect/jamie-prompt";
import type { ProtectFinding } from "@/types/protect";

vi.mock("@/lib/ai/capabilityGates", () => ({
  isCodeChangeCapabilityEnabledForOrg: vi.fn(),
}));

import { isCodeChangeCapabilityEnabledForOrg } from "@/lib/ai/capabilityGates";

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
  it("seeds propose_feature when the org code-change gate is off", async () => {
    vi.mocked(isCodeChangeCapabilityEnabledForOrg).mockResolvedValue(false);
    await expect(chooseProtectJamieTool(finding(), "org-1")).resolves.toBe("propose_feature");
  });

  it("seeds propose_code_change for a small single-file fix when the gate is on", async () => {
    vi.mocked(isCodeChangeCapabilityEnabledForOrg).mockResolvedValue(true);
    await expect(chooseProtectJamieTool(finding(), "org-1")).resolves.toBe("propose_code_change");
  });

  it("seeds propose_feature for multi-file or ambiguous findings", async () => {
    vi.mocked(isCodeChangeCapabilityEnabledForOrg).mockResolvedValue(true);
    await expect(
      chooseProtectJamieTool(
        finding({
          description: "Needs an architecture change across files",
          recommendation: "Redesign the auth module",
        }),
        "org-1",
      ),
    ).resolves.toBe("propose_feature");
  });
});

describe("buildProtectJamieSeed", () => {
  it("redacts secret-category evidence", () => {
    const seed = buildProtectJamieSeed(
      finding({ category: "secret", evidence: "sk-live-secret" }),
      "propose_feature",
    );
    expect(seed).not.toContain("sk-live-secret");
    expect(seed).toContain("redacted");
    expect(seed).toContain("propose_feature");
  });
});
