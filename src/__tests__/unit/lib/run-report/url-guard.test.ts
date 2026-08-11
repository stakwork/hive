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

const VALID = "https://stakwork-uploads.s3.us-east-1.amazonaws.com/reports/run-1/report.json";

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
      validate("https://attacker.com/stakwork-uploads.s3.us-east-1.amazonaws.com/x.json").ok,
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
    const result = validate("http://stakwork-uploads.s3.us-east-1.amazonaws.com/x.json");
    expect(result.ok === false && result.reason).toBe("not_https");
  });

  it("rejects a userinfo-bearing URL that would otherwise pass", async () => {
    const validate = await guard();
    const result = validate("https://user:pass@stakwork-uploads.s3.us-east-1.amazonaws.com/x.json");
    expect(result.ok === false && result.reason).toBe("userinfo_present");
  });

  it("rejects a non-standard port", async () => {
    const validate = await guard();
    const result = validate("https://stakwork-uploads.s3.us-east-1.amazonaws.com:8443/x.json");
    expect(result.ok === false && result.reason).toBe("port_not_allowed");
  });

  it("accepts an explicit :443", async () => {
    const validate = await guard();
    expect(validate("https://stakwork-uploads.s3.us-east-1.amazonaws.com:443/x.json").ok).toBe(true);
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

describe("validateReportUrl — bucket-pinned allowlist", () => {
  it("accepts legacy-global form for the known bucket", async () => {
    const validate = await guard();
    expect(validate("https://stakwork-uploads.s3.amazonaws.com/reports/run-1/report.json").ok).toBe(true);
  });

  it("accepts dot-regional form for the known bucket", async () => {
    const validate = await guard();
    expect(validate("https://stakwork-uploads.s3.us-east-1.amazonaws.com/reports/run-1/report.json").ok).toBe(true);
  });

  it("accepts dash-regional form for the known bucket", async () => {
    const validate = await guard();
    expect(validate("https://stakwork-uploads.s3-us-east-1.amazonaws.com/reports/run-1/report.json").ok).toBe(true);
  });

  it("rejects a different bucket in the legacy-global form", async () => {
    const validate = await guard();
    const result = validate("https://other-company-bucket.s3.amazonaws.com/x.json");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("host_not_allowed");
  });

  it("rejects path-style S3 URLs", async () => {
    const validate = await guard();
    expect(validate("https://s3.amazonaws.com/stakwork-uploads/x.json").ok).toBe(false);
  });

  it("rejects dualstack S3 URLs", async () => {
    const validate = await guard();
    expect(validate("https://stakwork-uploads.s3.dualstack.us-east-1.amazonaws.com/x.json").ok).toBe(false);
  });

  it("rejects accelerate S3 URLs", async () => {
    const validate = await guard();
    expect(validate("https://stakwork-uploads.s3-accelerate.amazonaws.com/x.json").ok).toBe(false);
  });

  it("rejects an unknown region label in the dot-regional form", async () => {
    const validate = await guard();
    // "unknown-region-99" is not in the KNOWN_REGIONS list
    const result = validate("https://stakwork-uploads.s3.unknown-region-99.amazonaws.com/x.json");
    expect(result.ok).toBe(false);
  });
});

describe("validateReportUrl — mock branch port hardening", () => {
  it("rejects a non-dev port even with USE_MOCKS=true on a non-production build", async () => {
    mockConfig.USE_MOCKS = true;
    // port 8080 is not in the dev-port allowlist ("" or "3000")
    const validate = await guard();
    const result = validate("http://localhost:8080/api/mock/run-report/full");
    expect(result.ok).toBe(false);
  });

  it("accepts port 3000 with USE_MOCKS=true", async () => {
    mockConfig.USE_MOCKS = true;
    const validate = await guard();
    expect(validate("http://localhost:3000/api/mock/run-report/full").ok).toBe(true);
  });

  it("accepts default port (empty) with USE_MOCKS=true", async () => {
    mockConfig.USE_MOCKS = true;
    const validate = await guard();
    expect(validate("http://localhost/api/mock/run-report/full").ok).toBe(true);
  });
});

describe("validateReportUrl — RUN_REPORT_ALLOWED_HOSTS validation", () => {
  it("discards IP literal entries silently", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "192.168.1.1,reports.example.com";
    const validate = await guard();
    // IP literal is discarded; the valid hostname still works
    expect(validate("https://reports.example.com/r.json").ok).toBe(true);
    // the IP address itself is NOT allowlisted
    expect(validate("https://192.168.1.1/r.json").ok).toBe(false);
  });

  it("discards loopback hostname entries", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "localhost,reports.example.com";
    const validate = await guard();
    // localhost is discarded even when explicitly listed
    expect(validate("https://reports.example.com/r.json").ok).toBe(true);
  });

  it("discards link-local IP entries", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "169.254.169.254,reports.example.com";
    const validate = await guard();
    expect(validate("https://169.254.169.254/x").ok).toBe(false);
    expect(validate("https://reports.example.com/r.json").ok).toBe(true);
  });

  it("discards entries without a dot (single-label names)", async () => {
    mockConfig.RUN_REPORT_ALLOWED_HOSTS = "intranet,reports.example.com";
    const validate = await guard();
    expect(validate("https://reports.example.com/r.json").ok).toBe(true);
    expect(validate("https://intranet/r.json").ok).toBe(false);
  });
});

describe("classifyS3HostForm", () => {
  it("classifies legacy-global form", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://mybucket.s3.amazonaws.com/x")).toBe("legacy_global");
  });

  it("classifies dash-regional form", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://mybucket.s3-us-east-1.amazonaws.com/x")).toBe("dash_regional");
  });

  it("classifies path-style form", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://s3.amazonaws.com/mybucket/x")).toBe("path_style");
  });

  it("classifies dualstack form", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://mybucket.s3.dualstack.us-east-1.amazonaws.com/x")).toBe("dualstack");
  });

  it("classifies accelerate form", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://mybucket.s3-accelerate.amazonaws.com/x")).toBe("accelerate");
  });

  it("classifies non-s3 amazonaws.com as non_s3", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://execute-api.us-east-1.amazonaws.com/x")).toBe("non_s3");
  });

  it("classifies a non-amazonaws domain as unparseable", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("https://reports.example.com/x")).toBe("unparseable");
  });

  it("classifies an unparseable string as unparseable", async () => {
    const { classifyS3HostForm } = await import("@/lib/run-report/url-guard");
    expect(classifyS3HostForm("not a url")).toBe("unparseable");
  });
});
