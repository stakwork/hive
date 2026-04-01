import { describe, it, expect } from "vitest";

/**
 * Unit tests for the seed message string used in handleSaveAndPlan.
 * Verifies exact wording injected into Plan Mode when transitioning from a PROTOTYPE task.
 */

function buildSeedMessage(branchName: string): string {
  return `A UI prototype has been built on branch \`${branchName}\`.
This branch must be used as the base branch for all UI implementation work.

When defining requirements, architecture, and the implementation plan, ensure that all UI-related tasks explicitly reference this branch as their base branch.

Architecture requirements:

Convert the prototype into a production-ready feature implemented on this branch.

Delete the temporary prototype/test page as part of the implementation (this is required, not optional cleanup).

The prototype should be treated as a visual and interaction reference only.
Plan and implement the real feature from this branch.`;
}

function buildFeatureChatPostBody(
  seedMessage: string,
  formattedHistory: unknown[]
): Record<string, unknown> {
  return { message: seedMessage, history: formattedHistory, isPrototype: true };
}

describe("handleSaveAndPlan — seed message", () => {
  it("names the branch as the base branch for all UI implementation work", () => {
    const msg = buildSeedMessage("feat/dashboard-ui");
    expect(msg).toContain("This branch must be used as the base branch for all UI implementation work.");
  });

  it("instructs all UI-related tasks to explicitly reference this branch", () => {
    const msg = buildSeedMessage("feat/dashboard-ui");
    expect(msg).toContain("all UI-related tasks explicitly reference this branch as their base branch");
  });

  it("instructs converting the prototype into a production-ready feature on this branch", () => {
    const msg = buildSeedMessage("feat/dashboard-ui");
    expect(msg).toContain("Convert the prototype into a production-ready feature implemented on this branch.");
  });

  it("makes test page deletion a required implementation task, not optional cleanup", () => {
    const msg = buildSeedMessage("feat/dashboard-ui");
    expect(msg).toContain("this is required, not optional cleanup");
  });

  it("frames prototype as visual and interaction reference only", () => {
    const msg = buildSeedMessage("feat/dashboard-ui");
    expect(msg).toContain("The prototype should be treated as a visual and interaction reference only.");
  });

  it("includes the branch name in backticks", () => {
    const branch = "feat/some-branch";
    const msg = buildSeedMessage(branch);
    expect(msg).toContain(`\`${branch}\``);
  });

  it("matches the exact expected seed message string", () => {
    const branch = "feat/my-feature";
    expect(buildSeedMessage(branch)).toBe(
      `A UI prototype has been built on branch \`${branch}\`.\nThis branch must be used as the base branch for all UI implementation work.\n\nWhen defining requirements, architecture, and the implementation plan, ensure that all UI-related tasks explicitly reference this branch as their base branch.\n\nArchitecture requirements:\n\nConvert the prototype into a production-ready feature implemented on this branch.\n\nDelete the temporary prototype/test page as part of the implementation (this is required, not optional cleanup).\n\nThe prototype should be treated as a visual and interaction reference only.\nPlan and implement the real feature from this branch.`
    );
  });
});

describe("handleSaveAndPlan — POST body to feature chat API", () => {
  it("includes isPrototype: true in the POST body sent to the feature chat API", () => {
    const msg = buildSeedMessage("feat/my-feature");
    const body = buildFeatureChatPostBody(msg, []);
    expect(body.isPrototype).toBe(true);
  });

  it("includes the seed message and history alongside isPrototype", () => {
    const msg = buildSeedMessage("feat/my-feature");
    const history = [{ role: "user", content: "hello" }];
    const body = buildFeatureChatPostBody(msg, history);
    expect(body.message).toBe(msg);
    expect(body.history).toEqual(history);
    expect(body.isPrototype).toBe(true);
  });
});
