/**
 * Tests for the pull-request–specific changes to job-turn.ts:
 *   - mapStrutArtifacts carries jobId + swarmId on every pull_request inline ref
 *     (URL path and inline-content path)
 *   - existing callers that omit jobId continue to work (no jobId on ref)
 *   - inlineContent pull_request path also works via mapStrutArtifacts
 *
 * The full job-turn test suite (job-turn.test.ts) still passes; this file
 * only adds coverage for the new behaviour without duplicating everything else.
 */

import { describe, it, expect } from "vitest";
import { mapStrutArtifacts, pullRequestContent } from "@/services/strut-runs/job-turn";
import type { StrutArtifact } from "@/services/strut-runs/job-turn";

const SWARM = "swarm-1";
const JOB = "job-abc-123";

const entry = (over: Partial<StrutArtifact>): StrutArtifact => ({
  id: "a",
  kind: "pull_request",
  title: "My PR",
  ...over,
});

// ── mapStrutArtifacts with jobId ────────────────────────────────────────────

describe("mapStrutArtifacts — pull_request inline refs carry jobId + swarmId", () => {
  it("absolute PR URL: inline ref has jobId and swarmId when jobId is supplied", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [entry({ url: "https://github.com/acme/app/pull/7" })],
      SWARM,
      JOB,
    );
    expect(dropped).toEqual([]);
    expect(refs).toHaveLength(1);
    const ref = refs[0];
    expect(ref.kind).toBe("pull_request");
    expect(ref.source.type).toBe("inline");
    if (ref.source.type !== "inline") return;
    expect(ref.source.content.jobId).toBe(JOB);
    expect(ref.source.content.swarmId).toBe(SWARM);
    expect(ref.source.content.repo).toBe("acme/app");
    expect(ref.source.content.number).toBe(7);
    expect(ref.source.content.state).toBe("open");
  });

  it("inline content PR: inline ref has jobId and swarmId when jobId is supplied", () => {
    const { refs, dropped } = mapStrutArtifacts(
      [
        entry({
          url: undefined,
          content: "https://github.com/acme/app/pull/9",
        }),
      ],
      SWARM,
      JOB,
    );
    expect(dropped).toEqual([]);
    expect(refs).toHaveLength(1);
    const ref = refs[0];
    expect(ref.kind).toBe("pull_request");
    if (ref.source.type !== "inline") throw new Error("expected inline");
    expect(ref.source.content.jobId).toBe(JOB);
    expect(ref.source.content.swarmId).toBe(SWARM);
  });

  it("no jobId supplied: inline ref has NO jobId or swarmId (backwards compat)", () => {
    const { refs } = mapStrutArtifacts(
      [entry({ url: "https://github.com/acme/app/pull/7" })],
      SWARM,
      // jobId intentionally omitted
    );
    expect(refs).toHaveLength(1);
    if (refs[0].source.type !== "inline") throw new Error("expected inline");
    expect(refs[0].source.content.jobId).toBeUndefined();
    expect(refs[0].source.content.swarmId).toBeUndefined();
  });

  it("strut-relative PR URL → graph ref (not inline), no jobId on source", () => {
    // A strut-relative PR link becomes `code` via a graph ref, not an inline PR ref.
    const JOB_LINK = `/jobs/${JOB}/files/pr.json`;
    const { refs, dropped } = mapStrutArtifacts(
      [entry({ url: JOB_LINK })],
      SWARM,
      JOB,
    );
    expect(dropped).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].source.type).toBe("graph");
    expect(refs[0].kind).toBe("code");
  });

  it("non-PR artifact types are unaffected by jobId", () => {
    const { refs } = mapStrutArtifacts(
      [
        { id: "md", kind: "markdown", title: "Plan", content: "# Plan", label: undefined, summary: undefined, url: undefined, error: undefined },
        { id: "img", kind: "image", title: "Screenshot", url: "https://cdn.example/shot.png", label: undefined, summary: undefined, content: undefined, error: undefined },
      ],
      SWARM,
      JOB,
    );
    expect(refs).toHaveLength(2);
    // markdown inline content should NOT have jobId
    const mdRef = refs[0];
    if (mdRef.source.type === "inline") {
      expect(mdRef.source.content.jobId).toBeUndefined();
    }
  });
});

// ── pullRequestContent passthrough of extra fields ──────────────────────────

describe("pullRequestContent — passthrough of extra fields", () => {
  it("existing extra fields (body, author, etc.) are kept in the output", () => {
    const result = pullRequestContent({
      url: "https://github.com/acme/app/pull/1",
      state: "open",
      author: "alice",
      body: "fixes #42",
    });
    expect(result?.author).toBe("alice");
    expect(result?.body).toBe("fixes #42");
  });

  it("null/undefined raw → null", () => {
    expect(pullRequestContent(null)).toBeNull();
    expect(pullRequestContent(undefined)).toBeNull();
  });
});
