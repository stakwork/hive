import { describe, it, expect } from "vitest";
import {
  getRoadmapCapabilitySnippet,
  getCanvasPromptSuffix,
} from "@/lib/constants/prompt";

describe("getRoadmapCapabilitySnippet — Stakwork workflow routing rule", () => {
  it("contains the stakwork-gating phrase 'only if'", () => {
    expect(getRoadmapCapabilitySnippet()).toContain("only if");
  });

  it("contains the stakwork workspace guard", () => {
    expect(getRoadmapCapabilitySnippet()).toContain(
      "a workspace named `stakwork` exists in the Available Workspaces list"
    );
  });

  it("contains the workflow routing directive", () => {
    expect(getRoadmapCapabilitySnippet()).toContain(
      "requests to create/update/fix a Stakwork workflow → propose_feature in the stakwork workspace"
    );
  });

  it("contains the fallback instruction to ask the user", () => {
    expect(getRoadmapCapabilitySnippet()).toContain(
      "ask the user which workspace owns the workflow"
    );
  });
});

describe("getCanvasPromptSuffix — includes Stakwork workflow routing rule", () => {
  it("contains the stakwork-gating rule via getRoadmapCapabilitySnippet", () => {
    const suffix = getCanvasPromptSuffix();
    expect(suffix).toContain("only if");
    expect(suffix).toContain("ask the user which workspace owns the workflow");
  });
});
