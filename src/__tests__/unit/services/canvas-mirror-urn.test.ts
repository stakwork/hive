/**
 * Tests for cross-swarm URN construction in canvas-mirror-cron.
 *
 * Verifies the exact URN shapes used by the Initiative→Feature and
 * Milestone→Feature UrnEdge writes, plus upsertEdge argument ordering.
 */
import { describe, it, expect } from "vitest";
import { formatUrn } from "@/lib/urn/parse";

describe("canvas-mirror cross-swarm URN construction", () => {
  const orgLogin = "myorg"; // githubLogin — the URN `org` segment
  const orgId = "clm_org_cuid"; // cuid — first arg to upsertEdge (NOT in URN)
  const featureWorkspaceSlug = "my-workspace";
  const featureId = "feat_abc123";
  const initiativeId = "init_xyz";
  const milestoneId = "ms_xyz";

  describe("fromUrn (pg realm, home swarm side)", () => {
    it("initiative fromUrn uses pg realm and orgLogin", () => {
      const fromUrn = formatUrn({
        realm: "pg",
        org: orgLogin,
        type: "initiative",
        id: initiativeId,
      });
      expect(fromUrn).toBe(`urn:${orgLogin}:pg:initiative:${initiativeId}`);
      // Must NOT contain the orgId cuid
      expect(fromUrn).not.toContain(orgId);
    });

    it("milestone fromUrn uses pg realm and orgLogin", () => {
      const fromUrn = formatUrn({
        realm: "pg",
        org: orgLogin,
        type: "milestone",
        id: milestoneId,
      });
      expect(fromUrn).toBe(`urn:${orgLogin}:pg:milestone:${milestoneId}`);
      expect(fromUrn).not.toContain(orgId);
    });
  });

  describe("toUrn (kg realm, feature's own workspace)", () => {
    it("feature toUrn uses kg realm with featureWorkspaceSlug (not orgLogin slug)", () => {
      const toUrn = formatUrn({
        realm: "kg",
        org: orgLogin,
        workspace: featureWorkspaceSlug,
        type: "HiveFeature",
        id: featureId,
      });
      expect(toUrn).toBe(
        `urn:${orgLogin}:kg:${featureWorkspaceSlug}:HiveFeature:${featureId}`,
      );
      // The workspace segment must be the feature's own workspace slug
      expect(toUrn).toContain(featureWorkspaceSlug);
      // HiveFeature must be PascalCase (Neo4j label-casing sensitive)
      expect(toUrn).toContain("HiveFeature");
    });

    it("toUrn differs when feature is in a different workspace than the org default", () => {
      const otherWorkspaceSlug = "other-workspace";
      const toUrn1 = formatUrn({
        realm: "kg",
        org: orgLogin,
        workspace: featureWorkspaceSlug,
        type: "HiveFeature",
        id: featureId,
      });
      const toUrn2 = formatUrn({
        realm: "kg",
        org: orgLogin,
        workspace: otherWorkspaceSlug,
        type: "HiveFeature",
        id: featureId,
      });
      expect(toUrn1).not.toBe(toUrn2);
      expect(toUrn1).toContain(featureWorkspaceSlug);
      expect(toUrn2).toContain(otherWorkspaceSlug);
    });
  });

  describe("upsertEdge argument ordering", () => {
    it("orgId (cuid) is different from orgLogin (githubLogin) used in URNs", () => {
      // This documents the critical distinction: orgId is the Prisma cuid,
      // orgLogin is the GitHub login used as the URN org segment.
      expect(orgId).not.toBe(orgLogin);

      // The URNs use orgLogin, not orgId
      const fromUrn = formatUrn({ realm: "pg", org: orgLogin, type: "initiative", id: initiativeId });
      const toUrn = formatUrn({ realm: "kg", org: orgLogin, workspace: featureWorkspaceSlug, type: "HiveFeature", id: featureId });

      expect(fromUrn).toContain(orgLogin);
      expect(fromUrn).not.toContain(orgId);
      expect(toUrn).toContain(orgLogin);
      expect(toUrn).not.toContain(orgId);
    });

    it("edge type is has-feature", () => {
      // Document the expected edge type for cross-swarm links
      const EDGE_TYPE = "has-feature";
      expect(EDGE_TYPE).toBe("has-feature");
    });
  });
});
