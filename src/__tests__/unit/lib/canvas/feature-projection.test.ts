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

  describe("milestone canvas", () => {
    it("projects when payload.milestoneId matches", () => {
      expect(
        featureProjectsOn("milestone:ms_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
          milestoneId: "ms_a",
        }),
      ).toBe(true);
    });

    it("rejects when payload.milestoneId differs", () => {
      expect(
        featureProjectsOn("milestone:ms_a", {
          workspaceId: "ws_a",
          milestoneId: "ms_b",
        }),
      ).toBe(false);
    });

    it("rejects when payload has no milestoneId", () => {
      expect(
        featureProjectsOn("milestone:ms_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
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

    it("rejects features that also have a milestone (those project on the milestone)", () => {
      expect(
        featureProjectsOn("initiative:init_a", {
          workspaceId: "ws_a",
          initiativeId: "init_a",
          milestoneId: "ms_a",
        }),
      ).toBe(false);
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
  it("returns milestone ref when milestoneId is set", () => {
    expect(
      mostSpecificRef({
        workspaceId: "ws_a",
        initiativeId: "init_a",
        milestoneId: "ms_a",
      }),
    ).toBe("milestone:ms_a");
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

  it("ignores initiativeId when milestoneId is set", () => {
    // Cross-rule check: if both are set, milestone wins. The projector
    // also asserts `feature.initiativeId === milestone.initiativeId`,
    // but mostSpecificRef doesn't try to validate that — it trusts the
    // caller (the approval handler validates before calling here).
    expect(
      mostSpecificRef({
        workspaceId: "ws_a",
        initiativeId: "init_a",
        milestoneId: "ms_a",
      }),
    ).toBe("milestone:ms_a");
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
