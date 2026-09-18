import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  applyProtectReviewFindings,
  buildFindingNodeKey,
  fingerprintTitle,
  parseProtectFinding,
  redactSecretEvidence,
} from "@/lib/protect/findings";
import * as nodes from "@/services/swarm/api/nodes";
import type { IncomingProtectFinding, ProtectFinding } from "@/types/protect";

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: vi.fn(),
  listNodesByType: vi.fn(),
  readNodeByRef: vi.fn(),
  updateNodeV2: vi.fn(),
}));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function incoming(overrides: Partial<IncomingProtectFinding> = {}): IncomingProtectFinding {
  return {
    category: "security",
    severity: "high",
    area: "auth",
    file: "src/login.ts",
    line: 10,
    title: "SQL injection",
    description: "raw query",
    evidence: "SELECT",
    recommendation: "parameterize",
    repositoryUrl: "https://github.com/acme/hive",
    ...overrides,
  };
}

function priorFinding(overrides: Partial<ProtectFinding> = {}, titlefingerprint?: string): ProtectFinding {
  const base = incoming();
  const node_key = buildFindingNodeKey(
    base.repositoryUrl,
    base.file,
    base.category,
    base.title,
    titlefingerprint,
  );
  return {
    ref_id: "ref-existing",
    node_key,
    id: node_key,
    category: base.category,
    severity: base.severity,
    area: base.area,
    file: base.file,
    line: 99,
    title: base.title,
    description: base.description,
    evidence: base.evidence,
    recommendation: base.recommendation,
    verification: "confirmed",
    status: "stale",
    repositoryUrl: base.repositoryUrl,
    ...overrides,
  };
}

describe("Protect finding node_key", () => {
  it("fingerprints title stably and excludes line", () => {
    const a = buildFindingNodeKey(
      "https://github.com/acme/hive",
      "src/login.ts",
      "security",
      "SQL injection",
    );
    const b = buildFindingNodeKey(
      "https://github.com/acme/hive",
      "src/login.ts",
      "security",
      "sql injection",
    );
    expect(a).toBe(b);
    expect(a).toContain(fingerprintTitle("SQL injection"));
    expect(a).not.toContain("10");
  });

  it("uses the explicit titlefingerprint verbatim when provided", () => {
    const nodeKey = buildFindingNodeKey(
      "https://github.com/acme/hive",
      "src/login.ts",
      "security",
      "SQL injection",
      "deadbeefcafef00d",
    );
    expect(nodeKey).toBe("https://github.com/acme/hive|src/login.ts|security|deadbeefcafef00d");
    // it is used verbatim, not re-hashed against the title
    expect(nodeKey).not.toContain(fingerprintTitle("SQL injection"));
  });

  it("falls back to fingerprintTitle when no titlefingerprint is supplied (legacy 4-arg call)", () => {
    const legacy = buildFindingNodeKey(
      "https://github.com/acme/hive",
      "src/login.ts",
      "security",
      "SQL injection",
    );
    expect(legacy).toBe(
      [
        "https://github.com/acme/hive",
        "src/login.ts",
        "security",
        fingerprintTitle("SQL injection"),
      ].join("|"),
    );
  });

  it("falls back to fingerprintTitle when titlefingerprint is an empty/whitespace string", () => {
    const withEmpty = buildFindingNodeKey(
      "https://github.com/acme/hive",
      "src/login.ts",
      "security",
      "SQL injection",
      "   ",
    );
    expect(withEmpty).toContain(fingerprintTitle("SQL injection"));
  });
});

describe("parseProtectFinding / redactSecretEvidence", () => {
  it("parses a valid node and redacts secret evidence", () => {
    const finding = parseProtectFinding({
      ref_id: "ref-1",
      node_type: "SecurityFinding",
      properties: {
        category: "secret",
        severity: "high",
        file: "src/keys.ts",
        title: "Hardcoded key",
        evidence: "sk-live",
        repositoryUrl: "https://github.com/acme/hive",
        status: "open",
      },
    });
    expect(finding?.category).toBe("secret");
    expect(redactSecretEvidence(finding!).evidence).toBe("");
  });

  it("returns null for incomplete nodes", () => {
    expect(
      parseProtectFinding({
        ref_id: "ref-1",
        node_type: "SecurityFinding",
        properties: { title: "missing fields" },
      }),
    ).toBeNull();
  });
});

describe("applyProtectReviewFindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nodes.addNode).mockResolvedValue({ success: true, ref_id: "new-ref" });
    vi.mocked(nodes.updateNodeV2).mockResolvedValue({ success: true, ref_id: "ref-existing" });
  });

  it("updates a matching node_key in place and reopens stale findings", async () => {
    const existing = priorFinding({ status: "stale" });
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: existing.ref_id,
          node_type: "SecurityFinding",
          properties: existing,
        },
      ],
    });

    const result = await applyProtectReviewFindings(CONFIG, [incoming({ line: 22 })], {
      mode: "full",
    });

    expect(result.counts.updated).toBe(1);
    expect(result.counts.created).toBe(0);
    expect(nodes.addNode).toHaveBeenCalledWith(
      CONFIG,
      expect.objectContaining({
        node_type: "SecurityFinding",
        node_data: expect.objectContaining({
          line: 22,
          status: "open",
          node_key: existing.node_key,
        }),
      }),
      { reprocess: true },
    );
    const nodeData = vi.mocked(nodes.addNode).mock.calls[0][1].node_data;
    expect(nodeData).not.toHaveProperty("verification");
  });

  it("marks unmatched prior findings stale and never inserts a second node", async () => {
    const existing = priorFinding({ status: "open" });
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [
        {
          ref_id: existing.ref_id,
          node_type: "SecurityFinding",
          properties: existing,
        },
      ],
    });

    const result = await applyProtectReviewFindings(
      CONFIG,
      [incoming({ file: "src/other.ts", title: "New issue" })],
      { mode: "full" },
    );

    expect(result.counts.created).toBe(1);
    expect(result.counts.stale).toBe(1);
    expect(nodes.updateNodeV2).toHaveBeenCalledWith(CONFIG, existing.ref_id, { status: "stale" });
    expect(nodes.addNode).toHaveBeenCalledTimes(1);
  });

  describe("with titlefingerprint-keyed prior findings", () => {
    const TITLE_FINGERPRINT = "0123456789abcdef";

    it("updates a matching titlefingerprint node_key in place and reopens stale findings", async () => {
      const existing = priorFinding({ status: "stale" }, TITLE_FINGERPRINT);
      vi.mocked(nodes.listNodesByType).mockResolvedValue({
        ok: true,
        nodes: [
          {
            ref_id: existing.ref_id,
            node_type: "SecurityFinding",
            properties: existing,
          },
        ],
      });

      const result = await applyProtectReviewFindings(
        CONFIG,
        [incoming({ line: 22, titlefingerprint: TITLE_FINGERPRINT })],
        { mode: "full" },
      );

      expect(result.counts.updated).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(nodes.addNode).toHaveBeenCalledWith(
        CONFIG,
        expect.objectContaining({
          node_type: "SecurityFinding",
          node_data: expect.objectContaining({
            line: 22,
            status: "open",
            node_key: existing.node_key,
          }),
        }),
        { reprocess: true },
      );
      const nodeData = vi.mocked(nodes.addNode).mock.calls[0][1].node_data;
      expect(nodeData).not.toHaveProperty("verification");
      expect(existing.node_key).toContain(TITLE_FINGERPRINT);
    });

    it("marks unmatched titlefingerprint-keyed prior findings stale and never inserts a second node", async () => {
      const existing = priorFinding({ status: "open" }, TITLE_FINGERPRINT);
      vi.mocked(nodes.listNodesByType).mockResolvedValue({
        ok: true,
        nodes: [
          {
            ref_id: existing.ref_id,
            node_type: "SecurityFinding",
            properties: existing,
          },
        ],
      });

      const result = await applyProtectReviewFindings(
        CONFIG,
        [
          incoming({
            file: "src/other.ts",
            title: "New issue",
            titlefingerprint: "fedcba9876543210",
          }),
        ],
        { mode: "full" },
      );

      expect(result.counts.created).toBe(1);
      expect(result.counts.stale).toBe(1);
      expect(nodes.updateNodeV2).toHaveBeenCalledWith(CONFIG, existing.ref_id, {
        status: "stale",
      });
      expect(nodes.addNode).toHaveBeenCalledTimes(1);
    });

    it("creates a new node when the incoming titlefingerprint does not match any prior key", async () => {
      const existing = priorFinding({ status: "open" }, TITLE_FINGERPRINT);
      vi.mocked(nodes.listNodesByType).mockResolvedValue({
        ok: true,
        nodes: [
          {
            ref_id: existing.ref_id,
            node_type: "SecurityFinding",
            properties: existing,
          },
        ],
      });

      const result = await applyProtectReviewFindings(
        CONFIG,
        [incoming({ titlefingerprint: "aaaaaaaaaaaaaaaa" })],
        { mode: "full" },
      );

      expect(result.counts.created).toBe(1);
      expect(result.counts.updated).toBe(0);
      expect(result.counts.stale).toBe(1);
    });
  });
});
