import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/protect/access", () => ({ requireProtectMemberAccess: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({
  canAccessServerFeature: vi.fn(() => true),
  FEATURE_FLAGS: { CODEBASE_RECOMMENDATION: "x" },
}));
vi.mock("@/services/strut-target", () => ({ resolveStrutTarget: vi.fn() }));
vi.mock("@/services/strut-runs", () => ({ labForRow: vi.fn() }));
vi.mock("@/lib/strut-run-graph/hydrate", () => ({ swarmCypherRunner: vi.fn() }));

import { canAccessServerFeature } from "@/lib/feature-flags";
import { requireProtectMemberAccess } from "@/lib/protect/access";
import { swarmCypherRunner } from "@/lib/strut-run-graph/hydrate";
import { labForRow } from "@/services/strut-runs";
import { resolveStrutTarget } from "@/services/strut-target";
import { clearSecurityAuditClassesCache, huntExcerpt } from "@/lib/system-map/security-audit-classes";
import { GET } from "@/app/api/workspaces/[slug]/system-map/security-audit/classes/route";

const params = { params: Promise.resolve({ slug: "ws" }) };
const req = () => new NextRequest("http://localhost/api/workspaces/ws/system-map/security-audit/classes");
const docs =
  "## When it applies\nAlways.\n## What to hunt\n- **Raw** SQL in [queries](http://x)\n- `exec` calls\n## Proof rule\nProve it.";

describe("security-audit classes GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSecurityAuditClassesCache();
    vi.mocked(requireProtectMemberAccess).mockReturnValue({
      workspaceId: "w1",
      userId: "u1",
      role: "DEVELOPER",
    } as never);
    vi.mocked(canAccessServerFeature).mockReturnValue(true);
    vi.mocked(resolveStrutTarget).mockResolvedValue({ ok: true, target: { swarmId: "s1" } } as never);
    vi.mocked(labForRow).mockResolvedValue({ swarmName: "hive", swarmApiKey: "k" } as never);
  });

  it("returns the live classes, with the hunt excerpt, and caches them", async () => {
    const run = vi.fn().mockResolvedValue({
      columns: ["ref_id", "name", "description", "docs"],
      rows: [
        ["r-1", "Injection", "Live injection.", docs],
        ["r-2", "New Class", "", ""],
      ],
    });
    vi.mocked(swarmCypherRunner).mockReturnValue(run);
    const body = await (await GET(req(), params)).json();
    expect(body.classes[0]).toEqual({
      ref_id: "r-1",
      name: "Injection",
      description: "Live injection.",
      hunt: "Raw SQL in queries exec calls",
      fallback: false,
    });
    expect(body.classes[1]).toMatchObject({ ref_id: "r-2", name: "New Class", fallback: true });
    await GET(req(), params);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to the built-in classes when the read fails", async () => {
    vi.mocked(swarmCypherRunner).mockReturnValue(vi.fn().mockResolvedValue({ unread: "500" }));
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const { classes } = await res.json();
    expect(classes).toHaveLength(9);
    expect(classes[0]).toMatchObject({ ref_id: null, name: "Injection", fallback: true, hunt: "" });
  });

  it("falls back when the strut target cannot be resolved", async () => {
    vi.mocked(resolveStrutTarget).mockResolvedValue({ ok: false, error: { type: "NO_ORG_SWARM" } } as never);
    const { classes } = await (await GET(req(), params)).json();
    expect(classes).toHaveLength(9);
  });

  it("passes through an access denial", async () => {
    vi.mocked(requireProtectMemberAccess).mockReturnValue(NextResponse.json({ error: "no" }, { status: 403 }) as never);
    expect((await GET(req(), params)).status).toBe(403);
  });

  it("404s without the feature flag", async () => {
    vi.mocked(canAccessServerFeature).mockReturnValue(false);
    expect((await GET(req(), params)).status).toBe(404);
  });
});

describe("huntExcerpt", () => {
  it("is empty without the section and trims long text", () => {
    expect(huntExcerpt("## Proof rule\nx")).toBe("");
    expect(huntExcerpt("## What to hunt\n" + "word ".repeat(200)).length).toBeLessThanOrEqual(401);
  });
});
