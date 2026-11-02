import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findWorkspace: vi.fn(),
  readNodes: vi.fn(),
  listInitiatives: vi.fn(),
  getTree: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { workspace: { findUnique: mocks.findWorkspace } } }));
vi.mock("@/lib/system-map/read-nodes", () => ({ readSystemMapNodes: mocks.readNodes }));
vi.mock("@/services/graph/workbench", () => ({
  listInitiatives: mocks.listInitiatives,
  getInitiativeTree: mocks.getTree,
}));

import { buildCanvasFocusTools } from "@/lib/ai/canvasFocusTool";
import { focusOf } from "@/app/org/[githubLogin]/_state/useSendCanvasChatMessage";

type Exec = (args: { target: string; view?: "plan" | "system" }) => Promise<Record<string, unknown>>;
const run: Exec = (args) =>
  (buildCanvasFocusTools({ userId: "u1", workspaceSlugs: ["ws"] }).focus_canvas as unknown as { execute: Exec }).execute(args);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findWorkspace.mockResolvedValue({ id: "w1" });
  mocks.readNodes.mockResolvedValue({
    ok: true,
    nodes: [
      { refId: "c-auth", type: "SysComponent", name: "auth service", properties: {} },
      { refId: "z-int", type: "SysTrustZone", name: "internal", properties: {} },
    ],
  });
  mocks.listInitiatives.mockResolvedValue({ ok: true, data: { initiatives: [{ ref_id: "i1", name: "Onboarding" }] } });
  mocks.getTree.mockResolvedValue({
    ok: true,
    data: { nodes: [{ ref_id: "f1", type: "InitiativeFeature", properties: { name: "Repo picker" } }] },
  });
});

describe("focus_canvas", () => {
  it("resolves a component to the System view", async () => {
    expect(await run({ target: "the auth component" })).toEqual({
      kind: "component",
      ref: "c-auth",
      name: "auth service",
      view: "system",
    });
  });

  it("resolves a zone to its plate ref", async () => {
    expect(await run({ target: "internal" })).toMatchObject({ kind: "zone", ref: "zone:internal", view: "system" });
  });

  it("returns a feature with the view asked for, or none so the canvas keeps the user's view", async () => {
    expect(await run({ target: "repo picker", view: "system" })).toMatchObject({ ref: "f1", view: "system" });
    expect(await run({ target: "repo picker" })).toMatchObject({ kind: "feature", ref: "f1", view: null });
  });

  it("says so, with close names, when nothing matches", async () => {
    const r = await run({ target: "repository" });
    expect(r.found).toBe(false);
    expect(String(r.message)).toContain("repository");
    expect(r.suggestions).toEqual(expect.any(Array));
  });

  it("is no candidates, not an error, when a read fails", async () => {
    mocks.readNodes.mockRejectedValue(new Error("boom"));
    mocks.listInitiatives.mockRejectedValue(new Error("boom"));
    expect((await run({ target: "auth" })).found).toBe(false);
  });
});

describe("focusOf (the client side of the result)", () => {
  it("takes a hit and ignores a miss", () => {
    expect(focusOf({ kind: "component", ref: "c", name: "x", view: "system" })).toEqual({
      kind: "component",
      ref: "c",
      name: "x",
      view: "system",
    });
    expect(focusOf({ kind: "feature", ref: "f", name: "y", view: null })?.view).toBeNull();
    expect(focusOf({ found: false, message: "no" })).toBeNull();
    expect(focusOf(undefined)).toBeNull();
  });
});
