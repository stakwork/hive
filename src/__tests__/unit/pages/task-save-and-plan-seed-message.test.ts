import { describe, it, expect } from "vitest";

/**
 * Unit tests for the seed message string used in handleSaveAndPlan.
 * Verifies exact wording injected into Plan Mode when transitioning from a PROTOTYPE task.
 */

function buildSeedMessage(branchName: string): string {
  return `A UI prototype has been built on branch \`${branchName}\`. Start by checking out the branch. The prototype contains a throwaway test page — this should be deleted during implementation. Use the prototype only as a visual design reference and plan the real feature.`;
}

describe("handleSaveAndPlan — seed message", () => {
  it("instructs the AI to check out the branch first", () => {
    const msg = buildSeedMessage("prototype/my-feature");
    expect(msg).toContain("Start by checking out the branch.");
  });

  it("frames test page deletion as an implementation step, not a planning directive", () => {
    const msg = buildSeedMessage("prototype/my-feature");
    expect(msg).toContain("this should be deleted during implementation");
    expect(msg).not.toContain("delete it entirely");
  });

  it("does not tell the AI to build from scratch", () => {
    const msg = buildSeedMessage("prototype/my-feature");
    expect(msg).not.toContain("build the real production component from scratch");
  });

  it("tells the AI to plan the real feature", () => {
    const msg = buildSeedMessage("prototype/my-feature");
    expect(msg).toContain("plan the real feature");
  });

  it("includes the branch name in backticks", () => {
    const branch = "prototype/some-branch";
    const msg = buildSeedMessage(branch);
    expect(msg).toContain(`\`${branch}\``);
  });

  it("matches the exact expected seed message string", () => {
    const branch = "prototype/my-feature";
    expect(buildSeedMessage(branch)).toBe(
      `A UI prototype has been built on branch \`${branch}\`. Start by checking out the branch. The prototype contains a throwaway test page — this should be deleted during implementation. Use the prototype only as a visual design reference and plan the real feature.`
    );
  });
});
