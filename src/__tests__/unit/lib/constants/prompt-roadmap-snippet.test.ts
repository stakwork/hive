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

describe("getRoadmapCapabilitySnippet — a bare 'workflow' means strut", () => {
  const snippet = getRoadmapCapabilitySnippet();

  it("states the strut default and the tools it resolves to", () => {
    expect(snippet).toContain('**"Workflow" means strut by default.**');
    expect(snippet).toContain(
      'that is the `strut` capability (`learn_capability("strut")`, then `dispatch_strut`)'
    );
  });

  it("names every Stakwork surface a bare workflow must NOT be routed to", () => {
    expect(snippet).toContain(
      "Do NOT route it to the stakwork workspace, its `stakwork__*` tools, the Stakwork workflow library (`workflow_explorer_agent`), or a feature in the stakwork workspace"
    );
  });

  it("does not fall back to Stakwork when strut is unavailable", () => {
    expect(snippet).toContain("do not fall back to Stakwork");
  });

  it("puts the strut default BEFORE the stakwork-workspace rule and gates that rule on the user saying Stakwork", () => {
    const strutRule = snippet.indexOf('"Workflow" means strut by default');
    const stakworkRule = snippet.indexOf(
      "If — and only if — a workspace named `stakwork` exists"
    );
    expect(strutRule).toBeGreaterThan(-1);
    expect(stakworkRule).toBeGreaterThan(strutRule);
    expect(snippet).toContain(
      "Stakwork tools are for requests that explicitly say **Stakwork**, and only then:"
    );
  });
});
