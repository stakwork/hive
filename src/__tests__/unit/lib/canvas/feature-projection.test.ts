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
    it("projects loose features (no initiative, no milestone)", () => {
      expect(
        featureProjectsOn("ws:ws_a", {
          workspaceId: "ws_a",
        }),
      ).toBe(true);
    });

    it("rejects features with an initiative (those project on the initiative)", () => {
      expect(
        featureProjectsOn("ws:ws_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
        }),
      ).toBe(false);
    });

    it("rejects features with a milestone", () => {
      expect(
        featureProjectsOn("ws:ws_a", {
          workspaceId: "ws_a",
          milestoneId: "ms_a",
        }),
      ).toBe(false);
    });

    it("rejects when workspaceId differs", () => {
      expect(
        featureProjectsOn("ws:ws_a", {
          workspaceId: "ws_b",
        }),
      ).toBe(false);
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
    it("treats null milestoneId as 'no milestone'", () => {
      expect(
        featureProjectsOn("ws:ws_a", {
          workspaceId: "ws_a",
          initiativeId: null,
          milestoneId: null,
        }),
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
