import { describe, it, expect } from "vitest";
import {
  MAX_FIX_BATCH,
  canTransition,
  classifyFinding,
  fixDisabledReason,
  getFixEligibility,
  isGithubPrUrl,
  mapWebhookStatus,
  planFixes,
  resolveFixRepository,
  validateFixBatch,
} from "@/lib/system-map/finding-fix";
import type { SystemMapFinding, SystemMapFindingFix } from "@/types/system-map";

function finding(over: Partial<SystemMapFinding> = {}, props: Record<string, unknown> = {}): SystemMapFinding {
  return {
    refId: "f1",
    title: "t",
    severity: "high",
    status: null,
    cweId: null,
    file: null,
    line: null,
    description: null,
    dateAdded: null,
    ...over,
    properties: { finding_status: "confirmed", ...props },
  };
}
const cwe = (props: Record<string, unknown> = {}) => finding({ cweId: "CWE-79", file: "a/b.ts" }, props);
const pkg = (props: Record<string, unknown> = {}) => finding({}, { purl: "pkg:npm/x@1", ...props });

describe("classifyFinding", () => {
  it("detects package CVEs", () => {
    expect(classifyFinding(pkg())).toBe("package_cve");
    expect(classifyFinding(finding({}, { type: "Vulnerable package" }))).toBe("package_cve");
    expect(classifyFinding(finding({}, { cve_id: "CVE-1" }))).toBe("package_cve");
  });
  it("detects code issues", () => {
    expect(classifyFinding(cwe())).toBe("code_issue");
  });
  it("returns null for other kinds", () => {
    expect(classifyFinding(finding())).toBeNull();
    expect(classifyFinding(finding({ cweId: "CWE-1" }))).toBeNull();
  });
});

describe("getFixEligibility", () => {
  it("accepts confirmed fixable findings", () => {
    expect(getFixEligibility(cwe())).toEqual({ eligible: true, kind: "code_issue" });
    expect(getFixEligibility(pkg())).toEqual({ eligible: true, kind: "package_cve" });
  });
  it("refuses unconfirmed", () => {
    for (const v of [undefined, "disconfirmed", ""]) {
      const r = getFixEligibility(cwe({ finding_status: v }));
      expect(r.eligible).toBe(false);
    }
    expect(getFixEligibility(cwe({ finding_status: " Confirmed " })).eligible).toBe(true);
  });
  it("refuses unsupported kinds with a reason", () => {
    const r = getFixEligibility(finding());
    expect(r).toMatchObject({ eligible: false });
    expect(r.eligible === false && r.reason).toMatch(/packages and code issues/);
  });
});

describe("fixDisabledReason", () => {
  const fix = (status: SystemMapFindingFix["status"]): SystemMapFindingFix => ({
    id: "x",
    findingRefId: "f1",
    kind: "code_issue",
    status,
    prUrl: null,
    error: null,
    createdAt: "",
    updatedAt: "",
  });
  it("blocks while queued/running only", () => {
    expect(fixDisabledReason(cwe(), fix("QUEUED"))).toMatch(/in progress/);
    expect(fixDisabledReason(cwe(), fix("RUNNING"))).toMatch(/in progress/);
    expect(fixDisabledReason(cwe(), fix("FAILED"))).toBeNull();
    expect(fixDisabledReason(cwe(), fix("PR_OPENED"))).toBeNull();
    expect(fixDisabledReason(cwe(), undefined)).toBeNull();
  });
});

describe("bulk cap and planning", () => {
  it("caps the batch", () => {
    expect(MAX_FIX_BATCH).toBe(10);
    expect(validateFixBatch([])).toMatch(/at least one/i);
    expect(validateFixBatch(Array.from({ length: MAX_FIX_BATCH }, (_, i) => `f${i}`))).toBeNull();
    expect(validateFixBatch(Array.from({ length: MAX_FIX_BATCH + 1 }, (_, i) => `f${i}`))).toMatch(/At most 10/);
  });
  it("splits accepted and refused", () => {
    const map = new Map([
      ["ok", { ...cwe(), refId: "ok" }],
      ["busy", { ...cwe(), refId: "busy" }],
      ["bad", { ...finding(), refId: "bad" }],
      ["unv", { ...cwe({ finding_status: "disconfirmed" }), refId: "unv" }],
    ]);
    const { accepted, refused } = planFixes(["ok", "busy", "bad", "unv", "gone"], map, new Set(["busy"]));
    expect(accepted.map((a) => a.finding.refId)).toEqual(["ok"]);
    expect(refused.map((r) => r.refId)).toEqual(["busy", "bad", "unv", "gone"]);
    expect(refused[0].reason).toMatch(/already in progress/);
  });
});

describe("resolveFixRepository", () => {
  const repos = [{ repositoryUrl: "https://github.com/acme/api" }, { repositoryUrl: "https://github.com/acme/web" }];
  it("uses the finding's repository property", () => {
    expect(resolveFixRepository(cwe({ repository: "acme/web" }), repos)).toBe(repos[1]);
  });
  it("uses a file path prefix", () => {
    expect(resolveFixRepository(finding({ file: "acme/api/src/x.ts" }), repos)).toBe(repos[0]);
  });
  it("falls back to the only repo, else null", () => {
    expect(resolveFixRepository(cwe(), [repos[0]])).toBe(repos[0]);
    expect(resolveFixRepository(cwe(), repos)).toBeNull();
  });
});

describe("mapWebhookStatus", () => {
  it("maps statuses", () => {
    expect(mapWebhookStatus("running", null)).toBe("RUNNING");
    expect(mapWebhookStatus("in_progress", undefined)).toBe("RUNNING");
    expect(mapWebhookStatus("queued", null)).toBe("QUEUED");
    expect(mapWebhookStatus("failed", null)).toBe("FAILED");
    expect(mapWebhookStatus("error", "https://github.com/a/b/pull/1")).toBe("FAILED");
  });
  it("a PR URL means PR_OPENED; completed without one fails", () => {
    expect(mapWebhookStatus("running", "https://github.com/a/b/pull/1")).toBe("PR_OPENED");
    expect(mapWebhookStatus(undefined, "https://github.com/a/b/pull/1")).toBe("PR_OPENED");
    expect(mapWebhookStatus("completed", null)).toBe("FAILED");
    expect(mapWebhookStatus("bogus", null)).toBeNull();
    expect(mapWebhookStatus(undefined, null)).toBeNull();
  });
  it("validates PR urls and transitions", () => {
    expect(isGithubPrUrl("https://github.com/a/b/pull/12")).toBe(true);
    expect(isGithubPrUrl("javascript:alert(1)")).toBe(false);
    expect(isGithubPrUrl("https://evil.com/a/b/pull/1")).toBe(false);
    expect(canTransition("QUEUED", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "QUEUED")).toBe(false);
    expect(canTransition("PR_OPENED", "FAILED")).toBe(false);
    expect(canTransition("FAILED", "RUNNING")).toBe(false);
  });
});
