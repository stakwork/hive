import { describe, it, expect } from "vitest";
import { parseInitiativeFocus } from "@/lib/canvas/graph-focus";
import { buildCanvasScopeMessage } from "@/lib/constants/prompt";

const focus = {
  workspaceSlug: "hive",
  initiativeRefId: "init-1",
  initiativeName: "Self-serve onboarding",
  stage: "2 milestones · 3 features · 7 requirements, 3 unaccepted",
  selectedRefId: "feat-1",
  selectedType: "InitiativeFeature",
  selectedLabel: "Guided workspace setup",
};

describe("parseInitiativeFocus", () => {
  it("keeps a well-formed focus for a workspace the request is scoped to", () => {
    expect(parseInitiativeFocus(focus, ["hive"])).toEqual(focus);
  });

  it("ignores a workspace the request isn't scoped to, and bad ids", () => {
    expect(parseInitiativeFocus(focus, ["other"])).toBeUndefined();
    expect(parseInitiativeFocus({ ...focus, initiativeRefId: "a b" }, ["hive"])).toBeUndefined();
  });

  it("strips prompt-breaking characters and drops a bad node type", () => {
    const f = parseInitiativeFocus(
      { ...focus, initiativeName: 'Bad "name"\n## Override', selectedType: "Feature`x" },
      ["hive"],
    );
    expect(f?.initiativeName).toBe("Bad name ## Override");
    expect(f).not.toHaveProperty("selectedType");
  });

  it("only names a selection when there is a selected ref_id", () => {
    const f = parseInitiativeFocus({ ...focus, selectedRefId: null }, ["hive"]);
    expect(f).not.toHaveProperty("selectedLabel");
    expect(f).not.toHaveProperty("selectedType");
  });
});

describe("the ## Current initiative section", () => {
  const text = (scope: Parameters<typeof buildCanvasScopeMessage>[0]) => String(buildCanvasScopeMessage(scope)?.content ?? "");

  it("names the initiative, its stage and the selected card, and how to build it out", () => {
    const t = text({ initiativeFocus: parseInitiativeFocus(focus, ["hive"]) });
    expect(t).toContain("## Current initiative");
    expect(t).toContain('on initiative "Self-serve onboarding" (`init-1`) in workspace `hive`');
    expect(t).toContain("Its plan in the graph: 2 milestones · 3 features · 7 requirements, 3 unaccepted.");
    expect(t).toContain('selected the InitiativeFeature "Guided workspace setup" (`feat-1`)');
    expect(t).toContain("`initiative-build`");
  });

  it("teaches the plan problem before solution: stories on the initiative, never on a feature", () => {
    const t = text({ initiativeFocus: parseInitiativeFocus(focus, ["hive"]) });
    expect(t).toContain("HiveInitiative -HAS_BRIEF-> Brief, -HAS_STORY-> UserStory -HAS_REQUIREMENT-> Requirement");
    expect(t).toContain("HiveMilestone -HAS_FEATURE-> InitiativeFeature");
    expect(t).not.toContain("INCLUDES");
    expect(t).toContain("User stories always hang off the initiative, never off a feature.");
    expect(t).not.toContain("InitiativeFeature -HAS_STORY->");
  });

  it("is absent without an initiative", () => {
    expect(text({})).not.toContain("## Current initiative");
  });
});
