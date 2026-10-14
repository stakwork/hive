import { describe, it, expect } from "vitest";
import {
  getRoadmapCapabilitySnippet,
  getCanvasPromptSuffix,
} from "@/lib/constants/prompt";
import { getSlimRoadmapCapabilitySnippet } from "@/lib/constants/prompt-slim";

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
      "requests to create/update/fix a Stakwork workflow → `start_job` naming the stakwork workspace as `@stakwork`"
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
      'that is the `strut` capability (use `dispatch_strut`)'
    );
  });

  it("names every Stakwork surface a bare workflow must NOT be routed to", () => {
    expect(snippet).toContain(
      "Do NOT route it to the stakwork workspace, its `stakwork__*` tools, the Stakwork workflow library (`workflow_explorer_agent`), or a feature in the stakwork workspace"
    );
  });

  // `strut` is composed for every org, and nothing in the system prompt
  // lists it as a capability. Wording that makes jobs conditional on it
  // being available let Jamie claim `start_job` was missing while it was
  // in its tool list, and route a single-repo change elsewhere.
  it.each([
    ["full", getRoadmapCapabilitySnippet],
    ["slim", getSlimRoadmapCapabilitySnippet],
  ])("does not make strut or jobs conditional on availability (%s)", (_name, get) => {
    const text = get();
    expect(text).not.toContain("not among your capabilities");
    expect(text).not.toContain("is in your tool list");
    expect(text).not.toContain("`start_job` is not available");
    expect(text).toContain("- **A job (`start_job`)** — use for a **focused change in one repository** that the user wants as a pull request. Name");
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
