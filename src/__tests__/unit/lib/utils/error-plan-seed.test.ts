/**
 * Unit tests for src/lib/utils/error-plan-seed.ts
 */
import { describe, it, expect } from "vitest";
import { buildErrorPlanSeedMessage } from "@/lib/utils/error-plan-seed";
import type { ErrorIssueRecord, ErrorEventRecord } from "@/types/error-issues";
import type { ParsedBlob } from "@/lib/utils/error-frames";

const baseIssue: ErrorIssueRecord = {
  id: "issue-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  repoKey: "acme/api",
  fingerprint: "abc123",
  exceptionType: "NoMethodError",
  title: "undefined method 'foo' for nil:NilClass",
  status: "UNRESOLVED",
  occurrenceCount: 5,
  firstSeenAt: "2024-01-01T00:00:00Z",
  lastSeenAt: "2024-01-02T00:00:00Z",
  environment: "production",
  release: "v1.2.3",
  metadata: null,
  kgRefId: null,
      correlatedPrNumber: null,
      correlatedPrUrl: null,
      correlatedCommitSha: null,
      correlationConfidence: null,
      correlationComputedAt: null,
      correlationCandidates: null,
};

const baseEvent: ErrorEventRecord = {
  id: "event-1",
  issueId: "issue-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  repoKey: "acme/api",
  exceptionType: "NoMethodError",
  message: "undefined method 'foo' for nil:NilClass",
  environment: "production",
  release: "v1.2.3",
  fingerprint: "abc123",
  commitSha: "deadbeef1234",
  repositoryUrl: "https://github.com/acme/api",
  defaultBranch: "main",
  createdAt: "2024-01-02T00:00:00Z",
};

describe("buildErrorPlanSeedMessage", () => {
  it("includes the framing directive", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).toContain("Investigate the root cause of this production error and propose a fix");
  });

  it("includes exceptionType", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).toContain("NoMethodError");
  });

  it("includes event message", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).toContain("undefined method 'foo' for nil:NilClass");
  });

  it("includes environment and release", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).toContain("production");
    expect(msg).toContain("v1.2.3");
  });

  it("includes commitSha from event", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).toContain("deadbeef1234");
  });

  it("includes repositoryUrl from event", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).toContain("https://github.com/acme/api");
  });

  it("falls back to repoKey when repositoryUrl is null", () => {
    const event = { ...baseEvent, repositoryUrl: null };
    const msg = buildErrorPlanSeedMessage(baseIssue, event);
    expect(msg).toContain("acme/api");
  });

  it("omits commitSha gracefully when null", () => {
    const event = { ...baseEvent, commitSha: null };
    const msg = buildErrorPlanSeedMessage(baseIssue, event);
    expect(msg).not.toContain("Commit");
  });

  it("works with no latestEvent (undefined)", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, undefined);
    expect(msg).toContain("NoMethodError");
    expect(msg).toContain("Investigate");
    // No message, commitSha, repositoryUrl from event
    expect(msg).not.toContain("deadbeef");
  });

  it("includes structured frames from blob when present", () => {
    const blob: ParsedBlob = {
      stackTrace: "ignored",
      frames: [
        { filename: "app/models/user.rb", function: "save", lineno: 42, inApp: true },
        { filename: "app/controllers/users_controller.rb", function: "create", lineno: 15 },
      ],
    };
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent, blob);
    expect(msg).toContain("app/models/user.rb");
    expect(msg).toContain(":42");
    expect(msg).toContain("in save");
    expect(msg).toContain("app/controllers/users_controller.rb");
    expect(msg).toContain(":15");
    expect(msg).toContain("in create");
  });

  it("falls back to rawStackTrace when frames is empty", () => {
    const blob: ParsedBlob = {
      stackTrace: "NoMethodError (foo)\n  app/models/user.rb:42:in 'save'",
      frames: [],
    };
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent, blob);
    expect(msg).toContain("NoMethodError (foo)");
    expect(msg).toContain("app/models/user.rb:42");
  });

  it("omits stack section when no blob provided", () => {
    const msg = buildErrorPlanSeedMessage(baseIssue, baseEvent);
    expect(msg).not.toContain("Stack");
  });

  it("handles missing optional fields gracefully (null environment/release)", () => {
    const issue = { ...baseIssue, environment: null, release: null };
    const event = { ...baseEvent, environment: null, release: null, commitSha: null, repositoryUrl: null };
    const msg = buildErrorPlanSeedMessage(issue, event);
    // Should still have framing + exceptionType
    expect(msg).toContain("Investigate");
    expect(msg).toContain("NoMethodError");
    // Should not have labels for missing fields
    expect(msg).not.toContain("Environment:");
    expect(msg).not.toContain("Release:");
    expect(msg).not.toContain("Commit:");
  });
});
