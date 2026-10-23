import { describe, it, expect } from "vitest";
import {
  MAX_FIX_BATCH,
  buildFindingFixSeed,
  deriveFixStatus,
  extractPrUrl,
  classifyFinding,
  fixDisabledReason,
  getFixEligibility,
  isGithubPrUrl,
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
    chatPath: null,
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

describe("deriveFixStatus", () => {
  const run = (kind: string, status: string, error?: string) => ({ kind, status: status as never, error });
  it("is PR_OPENED whenever a PR exists", () => {
    expect(deriveFixStatus([run("job_turn", "PENDING")], "https://github.com/a/b/pull/1").status).toBe("PR_OPENED");
  });
  it("is QUEUED until a job starts, then RUNNING", () => {
    expect(deriveFixStatus([], null).status).toBe("QUEUED");
    expect(deriveFixStatus([run("orchestrator_turn", "PENDING")], null).status).toBe("QUEUED");
    expect(deriveFixStatus([run("orchestrator_turn", "SUCCESS"), run("job_turn", "PENDING")], null).status).toBe(
      "RUNNING",
    );
    // the orchestrator woken after the job still counts as running
    expect(deriveFixStatus([run("job_turn", "SUCCESS"), run("orchestrator_turn", "PENDING")], null).status).toBe(
      "RUNNING",
    );
  });
  it("fails on error/lost/cancelled and on a clean end without a PR", () => {
    expect(deriveFixStatus([run("job_turn", "ERROR", "boom")], null)).toEqual({ status: "FAILED", error: "boom" });
    expect(deriveFixStatus([run("orchestrator_turn", "LOST")], null).status).toBe("FAILED");
    expect(deriveFixStatus([run("job_turn", "CANCELLED")], null).error).toMatch(/stopped/);
    expect(deriveFixStatus([run("orchestrator_turn", "SUCCESS"), run("job_turn", "SUCCESS")], null).error).toMatch(
      /without opening a pull request/,
    );
  });
});

describe("extractPrUrl / isGithubPrUrl", () => {
  const pr = (url: unknown) => ({
    id: "job-1",
    artifacts: [{ kind: "pull_request", source: { type: "inline", content: { url } } }],
  });
  it("reads the job's pull_request card", () => {
    expect(extractPrUrl([{ id: "u" }, pr("https://github.com/a/b/pull/7")])).toBe("https://github.com/a/b/pull/7");
  });
  it("ignores other kinds, bad urls and bad input", () => {
    expect(extractPrUrl([pr("javascript:alert(1)")])).toBeNull();
    expect(
      extractPrUrl([{ artifacts: [{ kind: "diff", source: { content: { url: "https://github.com/a/b/pull/1" } } }] }]),
    ).toBeNull();
    expect(extractPrUrl(null)).toBeNull();
    expect(isGithubPrUrl("https://evil.com/a/b/pull/1")).toBe(false);
  });
});

describe("buildFindingFixSeed", () => {
  it("tells the orchestrator to start a job that opens a PR on the repo", () => {
    const seed = buildFindingFixSeed(
      "code_issue",
      cwe({ api_token: "s3cret", evidence: "x" }),
      "ws",
      "https://github.com/acme/api",
    );
    expect(seed).toContain('start_job tool with workspace "ws"');
    expect(seed).toContain("https://github.com/acme/api");
    expect(seed).toContain("CWE-79");
    expect(seed).toContain("a/b.ts");
    expect(seed).not.toContain("s3cret");
  });
  it("asks for the fixed version for package CVEs", () => {
    expect(buildFindingFixSeed("package_cve", pkg({ fixed_in: "2.0.0" }), "ws", "r")).toMatch(/fixed version/);
  });
});
