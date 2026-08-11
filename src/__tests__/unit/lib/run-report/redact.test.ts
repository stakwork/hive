import { describe, it, expect } from "vitest";
import {
  redactSensitiveKeys,
  redactTokenShapes,
  REDACTED_KEYS,
} from "@/lib/run-report/redact";

describe("redactSensitiveKeys — depth", () => {
  it("redacts a sensitive key nested far past the old depth-10 bailout", () => {
    // The original helper returned the object UNTOUCHED once depth > 10, which
    // is exactly where per-agent transcript traces live.
    let node: Record<string, unknown> = { token: "sk-DEEPSECRET0123456789" };
    for (let i = 0; i < 25; i++) node = { [`lvl${i}`]: node };

    const out = JSON.stringify(redactSensitiveKeys(node));
    expect(out).not.toContain("DEEPSECRET");
    // Sensitive keys are now omitted entirely (no key → no value leakage).
    expect(out).not.toContain("token");
  });

  it("drops rather than passes through beyond the depth bound", () => {
    let node: Record<string, unknown> = { token: "sk-VERYDEEP0123456789" };
    for (let i = 0; i < 200; i++) node = { n: node };

    const out = JSON.stringify(redactSensitiveKeys(node));
    // Never emit an un-walked subtree unredacted.
    expect(out).not.toContain("VERYDEEP");
    expect(out).toContain("[DEPTH_EXCEEDED]");
  });
});

describe("redactSensitiveKeys — cycles", () => {
  it("terminates on a self-referential object", () => {
    const node: Record<string, unknown> = { a: 1, secret: "x" };
    node.self = node;

    expect(() => JSON.stringify(redactSensitiveKeys(node))).not.toThrow();
    expect(JSON.stringify(redactSensitiveKeys(node))).toContain("[CYCLE]");
  });

  it("does not mark sibling references to the same object as cycles", () => {
    const shared = { value: "keep-me" };
    const out = redactSensitiveKeys({ a: shared, b: shared }) as Record<string, unknown>;

    expect(JSON.stringify(out.a)).toContain("keep-me");
    expect(JSON.stringify(out.b)).toContain("keep-me");
  });
});

describe("redactSensitiveKeys — key set", () => {
  it("redacts the bundle URL under both spellings", () => {
    const out = JSON.stringify(
      redactSensitiveKeys({
        report_url: "https://b.s3.us-east-1.amazonaws.com/x.json",
        reportUrl: "https://b.s3.us-east-1.amazonaws.com/y.json",
      }),
    );
    expect(out).not.toContain("amazonaws.com");
  });

  it("redacts the webhook URL, which carries the run_token HMAC", () => {
    const out = JSON.stringify(
      redactSensitiveKeys({ webhookUrl: "https://hive.example/api/x?run_token=deadbeef" }),
    );
    expect(out).not.toContain("deadbeef");
  });

  it("still covers the original eight keys", () => {
    for (const key of ["authorization", "cookie", "token", "secret", "password", "x-api-key", "api_key", "apikey"]) {
      expect(REDACTED_KEYS.has(key)).toBe(true);
    }
  });
});

describe("token-shape pass — scoped, not global", () => {
  const SECRETS = {
    aws: "AKIAIOSFODNN7EXAMPLE",
    openai: "sk-abcdefghij0123456789",
    github: "ghp_ABCDEFGHIJ0123456789abcd",
    bearer: "Bearer abcdefghijklmnop1234567890",
  };

  it("scrubs token shapes when enabled (trace/config fields)", () => {
    const out = JSON.stringify(
      redactSensitiveKeys({ log: Object.values(SECRETS).join(" ") }, { tokenShapes: true }),
    );
    for (const secret of Object.values(SECRETS)) {
      expect(out).not.toContain(secret);
    }
  });

  it("LEAVES document bodies untouched when disabled", () => {
    // A blanket high-entropy match over converted legal documents would corrupt
    // docket numbers, registration ids and base64 exhibits — and the generator
    // already redacts secrets at emission time.
    const html = `<p>Registration no. ${SECRETS.aws} appears in the filing.</p>`;
    const out = JSON.stringify(redactSensitiveKeys({ html }, { tokenShapes: false }));
    expect(out).toContain(SECRETS.aws);
  });

  it("defaults to leaving values alone", () => {
    const out = JSON.stringify(redactSensitiveKeys({ text: SECRETS.aws }));
    expect(out).toContain(SECRETS.aws);
  });

  it("redactTokenShapes is idempotent and safe on plain prose", () => {
    expect(redactTokenShapes("no secrets here")).toBe("no secrets here");
    expect(redactTokenShapes(SECRETS.openai)).toBe("[REDACTED]");
    expect(redactTokenShapes(redactTokenShapes(SECRETS.openai))).toBe("[REDACTED]");
  });

  it("resets regex state between calls (module-level /g regexes)", () => {
    // A /g regex carries lastIndex; a leaked one makes the 2nd call miss.
    const input = `prefix ${SECRETS.aws} suffix`;
    expect(redactTokenShapes(input)).not.toContain(SECRETS.aws);
    expect(redactTokenShapes(input)).not.toContain(SECRETS.aws);
  });
});
