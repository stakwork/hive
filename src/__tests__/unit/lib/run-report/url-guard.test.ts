import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The guard reads `config.RUN_REPORT_ALLOWED_HOSTS` lazily so the env var can
 * be varied per case. Mock the config module rather than mutating process.env,
 * because src/config/env.ts snapshots at import time.
 */
const mockConfig = { RUN_REPORT_ALLOWED_HOSTS: "", USE_MOCKS: false };

vi.mock("@/config/env", () => ({
  get config() {
    return mockConfig;
  },
}));

const VALID = "https://my-bucket.s3.us-east-1.amazonaws.com/reports/run-1/report.json";

async function guard() {
  const mod = await import("@/lib/run-report/url-guard");
  return mod.validateReportUrl;
}

beforeEach(() => {
  mockConfig.RUN_REPORT_ALLOWED_HOSTS = "";
  mockConfig.USE_MOCKS = false;
});

afterEach(() => {
  vi.resetModules();
});

describe("validateReportUrl — host allowlist", () => {
  it("accepts a well-formed bucket URL with the regex default alone", async () => {
    const validate = await guard();
    expect(validate(VALID).ok).toBe(true);
  });

  it("rejects a suffix-lookalike host", async () => {
    const validate = await guard();
    const result = validate(
      "https://evil-bucket.s3.us-east-1.amazonaws.com.attacker.com/x.json",
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("host_not_allowed");
  });

  it("rejects the bucket host appearing as a path segment on another origin", async () => {
    const validate = await guard();
    expect(
      validate("https://attacker.com/my-bucket.s3.us-east-1.amazonaws.com/x.json").ok,
    ).toBe(false);
  });

  it("rejects a bare s3 host with no bucket subdomain", async () => {
    const validate = await guard();
    expect(validate("https://s3.us-east-1.amazonaws.com/bucket/x.json").ok).toBe(false);
  });
});

describe("validateReportUrl — URL shape", () => {
  it("rejects non-https", async () => {
    const validate = await guard();
    const result = validate("http://my-bucket.s3.us-east-1.amazonaws.com/x.json");
    expect(result.ok === false && result.reason).toBe("not_https");
  });

  it("rejects a userinfo-bearing URL that would otherwise pass", async () => {
    const validate = await guard();
    const result = validate("https://user:pass@my-bucket.s3.us-east-1.amazonaws.com/x.json");
    expect(result.ok === false && result.reason).toBe("userinfo_present");
  });

  it("rejects a non-standard port", async () => {
    const validate = await guard();
    const result = validate("https://my-bucket.s3.us-east-1.amazonaws.com:8443/x.json");
    expect(result.ok === false && result.reason).toBe("port_not_allowed");
  });

  it("accepts an explicit :443", async () => {
    const validate = await guard();
    expect(validate("https://my-bucket.s3.us-east-1.amazonaws.com:443/x.json").ok).toBe(true);
  });

  it("rejects unparseable input", async () => {
    const validate = await guard();
    expect(validate("not a url").ok).toBe(false);
  });

  it("rejects file: and the cloud metadata endpoint", async () => {
    const validate = await guard();
    expect(validate("file:///etc/passwd").ok).toBe(false);
    expect(validate("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });
});

describe("validateReportUrl — env var composition", () => {
  it("still accepts regex-default hosts when the env var is empty", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "";
    const validate = await guard();
    expect(validate(VALID).ok).toBe(true);
  });

  it("does not fail closed on an empty env var", async () => {
    // The whole point: an unset var must not ship the feature dark.
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "   ,  , ";
    const validate = await guard();
    expect(validate(VALID).ok).toBe(true);
  });

  it("extends the default with an exact hostname entry", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "reports.internal.example";
    const validate = await guard();
    expect(validate("https://reports.internal.example/r.json").ok).toBe(true);
    // and the regex default still applies alongside it
    expect(validate(VALID).ok).toBe(true);
  });

  it("does not treat an env entry as a suffix match", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "reports.internal.example";
    const validate = await guard();
    expect(validate("https://evil.reports.internal.example.attacker.com/r.json").ok).toBe(false);
  });
});

describe("validateReportUrl — mock loopback exemption", () => {
  it("is closed when mocks are off", async () => {
    mockConfig.USE_MOCKS = false;
    const validate = await guard();
    expect(validate("http://localhost:3000/api/mock/run-report/full").ok).toBe(false);
  });

  it("opens only for the mock report path when mocks are on", async () => {
    mockConfig.USE_MOCKS = true;
    const validate = await guard();
    expect(validate("http://localhost:3000/api/mock/run-report/full").ok).toBe(true);
    // never the whole self-origin
    expect(validate("http://localhost:3000/api/workspaces/x/secrets").ok).toBe(false);
  });
});
