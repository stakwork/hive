import { describe, it, expect } from "vitest";
import {
  featureProjectsOn,
  mostSpecificRef,
} from "@/lib/canvas/feature-projection";

describe("featureProjectsOn", () => {
  describe("root canvas", () => {
    it("never projects features on root", () => {
      expect(
        featureProjectsOn("", {
          workspaceId: "ws_a",
        }),
      ).toBe(false);
      expect(
        featureProjectsOn("", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
        }),
      ).toBe(false);
      expect(
        featureProjectsOn("", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
          milestoneId: "ms_a",
        }),
      ).toBe(false);
    });
  });

  describe("milestone refs (legacy / opaque — never project)", () => {
    // Milestones aren't drillable scopes. Pre-cutover deep links may
    // still carry `milestone:<id>` refs; the projector falls through
    // and emits no features.
    it("never projects on a milestone: ref, regardless of payload", () => {
      expect(
        featureProjectsOn("milestone:ms_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
          milestoneId: "ms_a",
        }),
      ).toBe(false);
      expect(
        featureProjectsOn("milestone:ms_a", {
          workspaceId: "ws_a",
        }),
      ).toBe(false);
    });
  });

  describe("initiative canvas", () => {
    it("projects initiative-loose features", () => {
      expect(
        featureProjectsOn("initiative:init_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
        }),
      ).toBe(true);
    });

    it("ALSO projects milestone-bound features anchored to the same initiative", () => {
      // Milestone-bound features render on their parent initiative's
      // canvas alongside the milestone cards; membership is shown by
      // a synthetic edge, not by relocating the feature to a separate
      // sub-canvas. The "most specific place wins" rule no longer
      // splits initiative-loose vs milestone-bound onto different
      // canvases — both land here.
      expect(
        featureProjectsOn("initiative:init_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
          milestoneId: "ms_a",
        }),
      ).toBe(true);
    });

    it("rejects when initiativeId differs", () => {
      expect(
        featureProjectsOn("initiative:init_a", {
          workspaceId: "ws_a",
          initiativeId: "init_b",
        }),
      ).toBe(false);
    });

    it("rejects when no initiativeId is set", () => {
      expect(
        featureProjectsOn("initiative:init_a", {
          workspaceId: "ws_a",
        }),
      ).toBe(false);
    });
  });

  describe("workspace canvas", () => {
    // The workspace canvas now projects features by EXPLICIT PIN only
    // (`CanvasBlob.assignedFeatures`). `featureProjectsOn` takes an
    // optional `assignedFeatures` third arg; on `ws:` refs the
    // function returns `true` iff the feature's id is in that list.
    // Callers that don't pass the list (or don't pass `featureId` on
    // the payload) fall through to `false` for workspace scopes,
    // which is the safe default — same effect as "not pinned."
    it("projects a pinned feature when its id is in assignedFeatures", () => {
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_a",
            featureId: "feat_1",
          },
          ["feat_1", "feat_2"],
        ),
      ).toBe(true);
    });

    it("rejects an unpinned feature even when workspaceId matches", () => {
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_a",
            featureId: "feat_99",
          },
          ["feat_1", "feat_2"],
        ),
      ).toBe(false);
    });

    it("rejects when assignedFeatures is undefined (no pin list passed)", () => {
      expect(
        featureProjectsOn("ws:ws_a", {
          workspaceId: "ws_a",
          featureId: "feat_1",
        }),
      ).toBe(false);
    });

    it("rejects when featureId is missing (can't check membership)", () => {
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_a",
          },
          ["feat_1"],
        ),
      ).toBe(false);
    });

    it("rejects when workspaceId differs even if id is in the list", () => {
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_b",
            featureId: "feat_1",
          },
          ["feat_1"],
        ),
      ).toBe(false);
    });

    it("a feature with an initiative does NOT auto-project on its workspace canvas (must be pinned)", () => {
      // Initiative-anchored features render on the initiative
      // sub-canvas via `milestoneTimelineProjector`, not on the
      // workspace canvas. Pinning one onto a workspace canvas IS
      // legal (and `featureProjectsOn` honors it) — what matters here
      // is that the initiative anchor doesn't change the workspace
      // canvas rule.
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_a",
            initiativeId: "init_a",
            featureId: "feat_1",
          },
          // not in list:
          ["feat_2"],
        ),
      ).toBe(false);
    });

    it("a feature with an initiative DOES project when pinned (initiative anchor doesn't block pinning)", () => {
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_a",
            initiativeId: "init_a",
            featureId: "feat_1",
          },
          ["feat_1"],
        ),
      ).toBe(true);
    });
  });

  describe("non-feature-bearing scopes", () => {
    it("rejects feature: refs", () => {
      expect(
        featureProjectsOn("feature:f_a", {
          workspaceId: "ws_a",
        }),
      ).toBe(false);
    });

    it("rejects authored node: refs", () => {
      expect(
        featureProjectsOn("node:n_a", {
          workspaceId: "ws_a",
        }),
      ).toBe(false);
    });

    it("rejects opaque refs", () => {
      expect(
        featureProjectsOn("foobar", {
          workspaceId: "ws_a",
        }),
      ).toBe(false);
    });
  });

  describe("null vs undefined milestoneId/initiativeId", () => {
    it("treats null milestoneId as 'no milestone' on a workspace canvas (still requires pin)", () => {
      // Under the new pin-based workspace projection, `null`
      // anchors alone aren't enough — the feature must also be in
      // the canvas's `assignedFeatures` list. This test pins it.
      expect(
        featureProjectsOn(
          "ws:ws_a",
          {
            workspaceId: "ws_a",
            initiativeId: null,
            milestoneId: null,
            featureId: "feat_1",
          },
          ["feat_1"],
        ),
      ).toBe(true);
    });

    it("treats null initiativeId as 'no initiative'", () => {
      expect(
        featureProjectsOn("initiative:init_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
          milestoneId: null,
        }),
      ).toBe(true);
    });
  });
});

describe("mostSpecificRef", () => {
  it("returns initiative ref when milestoneId+initiativeId are both set", () => {
    // Milestone membership doesn't push the ref to a `milestone:`
    // scope (no such scope exists). The feature lands on its parent
    // initiative's canvas with a synthetic edge expressing membership.
    // Coherence rule in `services/roadmap/features.ts` ensures
    // `initiativeId` is set whenever `milestoneId` is, so this branch
    // is the realistic case.
    expect(
      mostSpecificRef({
        workspaceId: "ws_a",
        initiativeId: "init_a",
        milestoneId: "ms_a",
      }),
    ).toBe("initiative:init_a");
  });

  it("returns initiative ref when only initiativeId is set", () => {
    expect(
      mostSpecificRef({
        workspaceId: "ws_a",
        initiativeId: "init_a",
      }),
    ).toBe("initiative:init_a");
  });

  it("returns workspace ref when neither is set", () => {
    expect(
      mostSpecificRef({
        workspaceId: "ws_a",
      }),
    ).toBe("ws:ws_a");
  });

  it("treats null as not-set", () => {
    expect(
      mostSpecificRef({
        workspaceId: "ws_a",
        initiativeId: null,
        milestoneId: null,
      }),
    ).toBe("ws:ws_a");
  });
});
