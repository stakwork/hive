/**
 * Org-gating of the `prompts` capability.
 *
 * `resolveOrgCapabilities` = `resolveCapabilities` (includes expansion) +
 * async per-capability `orgGate` filtering. These tests lock the security
 * contract: the globally-scoped prompt library's read/propose tools are
 * composed ONLY for orgs the gate approves, and are never re-introduced via
 * `roadmap`'s `includes` expansion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every capability tool builder so importing capabilities.ts stays light.
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({ buildGraphWalkerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/promptTools", () => ({ buildPromptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/conceptTools", () => ({ buildConceptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
}));
vi.mock("ai", () => ({ tool: vi.fn((t: unknown) => t) }));
vi.mock("@/lib/proposals/types", () => ({
  PROPOSE_FEATURE_TOOL: "propose_feature",
  PROPOSE_INITIATIVE_TOOL: "propose_initiative",
  PROPOSE_MILESTONE_TOOL: "propose_milestone",
  PROPOSE_NEW_PROMPT_TOOL: "propose_new_prompt",
  PROPOSE_PROMPT_UPDATE_TOOL: "propose_prompt_update",
  PROPOSE_NEW_CONCEPT_TOOL: "propose_new_concept",
  PROPOSE_CONCEPT_UPDATE_TOOL: "propose_concept_update",
}));

// The gate itself is exercised elsewhere; here we control its verdict.
const isPromptsCapabilityEnabledForOrg = vi.fn<
  (orgId: string | undefined) => Promise<boolean>
>();
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: (orgId: string | undefined) =>
    isPromptsCapabilityEnabledForOrg(orgId),
}));

import {
  resolveCapabilities,
  resolveOrgCapabilities,
} from "@/lib/ai/capabilities";

describe("prompts capability org-gating", () => {
  beforeEach(() => {
    isPromptsCapabilityEnabledForOrg.mockReset();
  });

  it("roadmap's sync includes expansion does NOT pull in prompts", () => {
    // Gated capabilities must never ride in on `includes` — the sync
    // resolver can't run the async gate, so this is the invariant that
    // keeps the gate authoritative.
    const resolved = resolveCapabilities(["roadmap"]);
    expect(resolved).not.toContain("prompts");
    // sanity: the ungated loadables still expand
    expect(resolved).toContain("whiteboard");
    expect(resolved).toContain("infra");
  });

  it("keeps prompts for an allow-listed (stakwork) org", async () => {
    isPromptsCapabilityEnabledForOrg.mockResolvedValue(true);
    const resolved = await resolveOrgCapabilities(["roadmap", "prompts"], "org-stakwork");
    expect(resolved).toContain("prompts");
    expect(isPromptsCapabilityEnabledForOrg).toHaveBeenCalledWith("org-stakwork");
  });

  it("drops prompts for a non-allow-listed org even when explicitly selected", async () => {
    isPromptsCapabilityEnabledForOrg.mockResolvedValue(false);
    const resolved = await resolveOrgCapabilities(["roadmap", "prompts"], "org-other");
    expect(resolved).not.toContain("prompts");
    // ungated capabilities are unaffected
    expect(resolved).toContain("roadmap");
    expect(resolved).toContain("whiteboard");
  });

  it("drops prompts when orgId is undefined (fails closed)", async () => {
    isPromptsCapabilityEnabledForOrg.mockResolvedValue(false);
    const resolved = await resolveOrgCapabilities(["prompts"], undefined);
    expect(resolved).not.toContain("prompts");
    expect(isPromptsCapabilityEnabledForOrg).toHaveBeenCalledWith(undefined);
  });

  it("does not invoke the gate for ungated capabilities", async () => {
    isPromptsCapabilityEnabledForOrg.mockResolvedValue(true);
    const resolved = await resolveOrgCapabilities(["planner"], "org-x");
    expect(resolved).toEqual(["planner"]);
    expect(isPromptsCapabilityEnabledForOrg).not.toHaveBeenCalled();
  });
});
