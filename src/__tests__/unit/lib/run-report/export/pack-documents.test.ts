import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  packDocuments,
  resolveEntryName,
  PACK_MAX_FILES,
  PACK_MAX_TOTAL_BYTES,
} from "@/lib/run-report/export/pack-documents";

// ── Mock setup ────────────────────────────────────────────────────────────────

const mockConfig = { RUN_REPORT_ALLOWED_HOSTS: "", USE_MOCKS: false };
vi.mock("@/config/env", () => ({
  get config() {
    return mockConfig;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// A valid S3 URL that passes the SSRF guard
const VALID_URL = "https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/file.pdf";

function makeBodyStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function okResponse(content: string | Uint8Array, url = VALID_URL) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-length": String(bytes.byteLength) }),
    body: makeBodyStream(bytes),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockConfig.RUN_REPORT_ALLOWED_HOSTS = "";
  mockConfig.USE_MOCKS = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── SSRF guard ────────────────────────────────────────────────────────────────

describe("packDocuments — SSRF guard", () => {
  it("rejects non-https URLs", async () => {
    const result = await packDocuments(["http://evil.com/file.pdf"]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain("http://evil.com/file.pdf");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted HTTPS hosts", async () => {
    const result = await packDocuments(["https://evil.com/file.pdf"]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain("https://evil.com/file.pdf");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects URLs with userinfo (credentials)", async () => {
    const result = await packDocuments([
      "https://user:pass@stakwork-uploads.s3.us-east-1.amazonaws.com/file.pdf",
    ]);
    expect(result.packed).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects unparseable URLs", async () => {
    const result = await packDocuments(["not a url at all"]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain("not a url at all");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts a valid allowlisted S3 URL", async () => {
    mockFetch.mockResolvedValue(okResponse("hello"));
    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });
});

// ── Anonymous fetch (no credentials) ─────────────────────────────────────────

describe("packDocuments — anonymous fetch (no credentials)", () => {
  it("never attaches an Authorization header", async () => {
    mockFetch.mockResolvedValue(okResponse("content"));
    await packDocuments([VALID_URL]);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string> | undefined;
    if (headers) {
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    }
    // Also assert no GITHUB_TOKEN-shaped header
    if (headers) {
      const headerStr = JSON.stringify(headers).toLowerCase();
      expect(headerStr).not.toContain("github_token");
      expect(headerStr).not.toContain("token");
    }
  });

  it("does not pass the GITHUB_TOKEN env var to fetch", async () => {
    // Set GITHUB_TOKEN in env (simulated)
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_EXAMPLETOKENVALUE0123456789";
    mockFetch.mockResolvedValue(okResponse("content"));

    await packDocuments([VALID_URL]);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headersJson = JSON.stringify(opts.headers ?? {});
    expect(headersJson).not.toContain("ghp_EXAMPLETOKENVALUE0123456789");

    process.env.GITHUB_TOKEN = originalToken;
  });
});

// ── Redirect re-validation ────────────────────────────────────────────────────

describe("packDocuments — redirect re-validation", () => {
  it("rejects a redirect to a disallowed host", async () => {
    // Response comes from a non-allowlisted URL (simulates redirect bypass)
    const redirectedUrl = "https://evil.com/exfiltrated-file.pdf";
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: redirectedUrl,
      headers: new Headers({ "content-length": "5" }),
      body: makeBodyStream(new TextEncoder().encode("hello")),
    });

    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain(VALID_URL);
  });

  it("accepts a redirect to another allowlisted S3 host", async () => {
    // Regional endpoint redirect — still valid
    const redirectedUrl =
      "https://stakwork-uploads.s3.us-west-2.amazonaws.com/docs/file.pdf";
    mockFetch.mockResolvedValue(okResponse("content", redirectedUrl));

    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(1);
  });
});

// ── Per-file byte cap ─────────────────────────────────────────────────────────

describe("packDocuments — per-file byte cap", () => {
  it("rejects a file whose Content-Length exceeds the per-file cap", async () => {
    const tooBig = 26 * 1024 * 1024; // 26 MB > MAX_BUNDLE_BYTES (25 MB)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: VALID_URL,
      headers: new Headers({ "content-length": String(tooBig) }),
      body: makeBodyStream(new Uint8Array(0)),
    });

    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain(VALID_URL);
  });

  it("rejects a file that exceeds the cap mid-stream", async () => {
    // No Content-Length declared, but body exceeds cap
    const tooBig = 26 * 1024 * 1024;
    const bigBytes = new Uint8Array(tooBig);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: VALID_URL,
      headers: new Headers(),
      body: makeBodyStream(bigBytes),
    });

    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain(VALID_URL);
  });
});

// ── Total budget ──────────────────────────────────────────────────────────────

describe("packDocuments — total budget enforcement", () => {
  it("exports the correct max files constant", () => {
    expect(PACK_MAX_FILES).toBe(25);
  });

  it("exports a finite max total bytes constant", () => {
    expect(PACK_MAX_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(Number.isFinite(PACK_MAX_TOTAL_BYTES)).toBe(true);
  });

  it("skips documents beyond the file count budget", async () => {
    // Set up PACK_MAX_FILES + 5 unique URLs
    const urls = Array.from(
      { length: PACK_MAX_FILES + 5 },
      (_, i) =>
        `https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/file-${i}.pdf`,
    );

    // Use mockImplementation (not mockResolvedValue) so a fresh ReadableStream
    // is created for each call — a ReadableStream can only be read once and
    // sharing the same instance across calls causes all but the first to fail.
    mockFetch.mockImplementation(async (url: string) => okResponse("small content", url));

    const result = await packDocuments(urls);
    expect(result.packed).toHaveLength(PACK_MAX_FILES);
    expect(result.skipped).toHaveLength(5);
  });

  it("stops when combined size would exceed total byte budget", async () => {
    // Each file is just under 20 MB; 3 files = 60 MB > 50 MB
    const nearlyMaxBytes = 20 * 1024 * 1024;
    const urls = [
      "https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/a.pdf",
      "https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/b.pdf",
      "https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/c.pdf",
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/x.pdf",
      headers: new Headers({ "content-length": String(nearlyMaxBytes) }),
      body: makeBodyStream(new Uint8Array(nearlyMaxBytes)),
    });

    const result = await packDocuments(urls);
    // After 2 files (40 MB), the 3rd (20 MB more = 60 MB) exceeds the 50 MB budget
    expect(result.packed.length).toBeLessThanOrEqual(2);
    expect(result.skipped).toContain(urls[2]);
  });
});

// ── Entry name sanitization ───────────────────────────────────────────────────

describe("resolveEntryName — sanitization", () => {
  it("strips path separators from traversal attempts", () => {
    const used = new Set<string>();
    expect(resolveEntryName("https://host.com/../evil.pdf", used)).toBe("evil.pdf");
  });

  it("strips leading dots from filenames", () => {
    const used = new Set<string>();
    const name = resolveEntryName("https://host.com/....hidden.txt", used);
    expect(name).not.toMatch(/^\./);
  });

  it("sanitizes backslash path separators", () => {
    const used = new Set<string>();
    const name = resolveEntryName("https://host.com/path\\..\\evil.pdf", used);
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
  });

  it("strips control characters", () => {
    const used = new Set<string>();
    const name = resolveEntryName("https://host.com/file\x00\x1fnormal.pdf", used);
    expect(name).not.toMatch(/[\x00-\x1F]/);
  });

  it("falls back to 'document' when basename is empty after sanitization", () => {
    const used = new Set<string>();
    const name = resolveEntryName("https://host.com/", used);
    expect(name).toBe("document");
  });

  it("handles absolute paths in basename", () => {
    const used = new Set<string>();
    const name = resolveEntryName("https://host.com/%2Fetc%2Fpasswd", used);
    // After decoding and sanitization, should not start with /
    expect(name).not.toMatch(/^\//);
    expect(name.toLowerCase()).not.toBe("passwd");
    // The leading slash is stripped — what remains depends on decode
  });

  it("uniquifies collisions with -2, -3 suffixes", () => {
    const used = new Set(["file.pdf"]);
    const name = resolveEntryName("https://host.com/file.pdf", used);
    expect(name).toBe("file-2.pdf");
  });

  it("further uniquifies a second collision", () => {
    const used = new Set(["file.pdf", "file-2.pdf"]);
    const name = resolveEntryName("https://host.com/file.pdf", used);
    expect(name).toBe("file-3.pdf");
  });

  it("never returns 'index.html' (reserved)", () => {
    const used = new Set<string>(["index.html"]);
    // A URL whose basename would be index.html
    const name = resolveEntryName("https://host.com/index.html", used);
    expect(name).not.toBe("index.html");
    expect(name).toMatch(/^index-\d+\.html$/);
  });

  it("never returns 'bundle.json' (reserved)", () => {
    const used = new Set<string>(["bundle.json"]);
    const name = resolveEntryName("https://host.com/bundle.json", used);
    expect(name).not.toBe("bundle.json");
    expect(name).toMatch(/^bundle-\d+\.json$/);
  });

  it("handles URLs with query strings (strips them)", () => {
    const used = new Set<string>();
    const name = resolveEntryName(
      "https://host.com/report.pdf?token=secret&v=1",
      used,
    );
    expect(name).toBe("report.pdf");
    expect(name).not.toContain("token");
    expect(name).not.toContain("secret");
  });

  it("handles percent-encoded characters in filename", () => {
    const used = new Set<string>();
    const name = resolveEntryName(
      "https://host.com/my%20document.pdf",
      used,
    );
    expect(name).toBe("my document.pdf");
  });
});

// ── Non-OK HTTP responses ─────────────────────────────────────────────────────

describe("packDocuments — HTTP errors", () => {
  it("skips documents that return a non-OK HTTP status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      url: VALID_URL,
      headers: new Headers(),
      body: makeBodyStream(new TextEncoder().encode("Forbidden")),
    });

    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain(VALID_URL);
  });

  it("skips documents on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const result = await packDocuments([VALID_URL]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toContain(VALID_URL);
  });

  it("never throws — all errors degrade to skipped", async () => {
    mockFetch.mockRejectedValue(new Error("Catastrophic failure"));
    await expect(packDocuments([VALID_URL])).resolves.toBeDefined();
  });
});

// ── Successful packing ────────────────────────────────────────────────────────

describe("packDocuments — success path", () => {
  it("returns packed entries with the correct structure", async () => {
    const content = "PDF content here";
    const url2 = "https://stakwork-uploads.s3.us-east-1.amazonaws.com/docs/doc2.pdf";

    mockFetch.mockImplementation(async (url: string) => okResponse(content, url));

    const result = await packDocuments([VALID_URL, url2]);

    expect(result.packed).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    for (const doc of result.packed) {
      expect(doc.url).toBeDefined();
      expect(doc.entryName).toBeDefined();
      expect(doc.bytes).toBeInstanceOf(Uint8Array);
      const decoded = new TextDecoder().decode(doc.bytes);
      expect(decoded).toBe(content);
    }
  });

  it("handles empty input", async () => {
    const result = await packDocuments([]);
    expect(result.packed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
