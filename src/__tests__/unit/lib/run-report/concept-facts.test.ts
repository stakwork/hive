/**
 * Unit tests for src/lib/run-report/concept-facts.ts
 *
 * Coverage:
 *  - readBundleNodeIdentities: fallback reasons, validation rules
 *  - selectNodeIdentities: round-trip, forceSource seam, cap-divergence
 *  - deriveTopConcepts: byName vs perIdentity, name-collision, ordering
 *  - deriveAllSurfacedHint: both denominators pinned
 *  - compareTopConcepts: set-membership only
 *  - mergeIdentityRows extraction regression
 *  - readContentFlag / has_content tri-state
 */

import { describe, it, expect } from "vitest";
import {
  readBundleNodeIdentities,
  selectNodeIdentities,
  deriveTopConcepts,
  deriveAllSurfacedHint,
  compareTopConcepts,
} from "@/lib/run-report/concept-facts";
import {
  readToolActivity,
  buildNodeIdentities,
  mergeIdentityRows,
  readContentFlag,
  HAS_CONTENT_KEYS,
} from "@/lib/run-report/tool-activity";
import type { NodeIdentityRow } from "@/lib/run-report/tool-activity";

// ── Malformed fixtures ────────────────────────────────────────────────────────
import {
  MALFORMED_WRONG_TYPE,
  MALFORMED_EMPTY_ARRAY,
  MALFORMED_MISSING_AGENTS,
  MALFORMED_EMPTY_AGENTS,
  MALFORMED_BAD_IDENTITY_KIND,
  MALFORMED_MISSING_IDENTITY_KIND,
  MALFORMED_RETRIEVED_NULL_BASIS,
  MALFORMED_SURFACED_WITH_BASIS,
  MALFORMED_RETRIEVED_NO_AGENT_RETRIEVED,
  MALFORMED_URN_WRONG_KIND,
  MALFORMED_KEY_COLLISION,
} from "@/app/api/mock/run-report/fixtures/concept-facts-malformed";

// ── Golden fixture ────────────────────────────────────────────────────────────
import {
  DERIVED_CONCEPTS_GOLDEN,
  GOLDEN_NODE_IDENTITIES,
  GOLDEN_ROSTER,
} from "@/app/api/mock/run-report/fixtures/derived-concepts-golden";

// ── Scenario fixtures ─────────────────────────────────────────────────────────
import {
  ONTOLOGY_ONLY,
  ONTOLOGY_WITH_IDENTITIES,
  NAME_COLLISION,
  HAS_CONTENT_TRUE,
  HAS_CONTENT_FALSE,
  HAS_CONTENT_ABSENT,
} from "@/app/api/mock/run-report/fixtures/concept-facts-scenarios";

// ── Round-trip fixture (programmatic) ────────────────────────────────────────
import { WITH_DERIVED_CONCEPTS } from "@/app/api/mock/run-report/fixtures/with-derived-concepts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function rosterMap(...names: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of names) m.set(n.toLowerCase(), n);
  return m;
}

const DEFAULT_ROSTER = rosterMap("cross_check_agent", "drafter");

const NO_CAP_LIMITS = {
  arrayCapRows: 1000,
  callsPerAgentTruncated: false,
  nodesPerCallTruncated: false,
};

function runActivity(
  records: unknown[],
  roster?: Map<string, string>,
  callsPerAgentCap?: number,
  nodesPerCallCap?: number,
) {
  return readToolActivity(
    { tool_activity: records },
    roster ?? DEFAULT_ROSTER,
    callsPerAgentCap,
    nodesPerCallCap,
  );
}

function singleCall(
  toolName: string,
  nodes: unknown[],
  input: unknown = { query: "test" },
  agentName = "cross_check_agent",
) {
  return { agent_name: agentName, tool_name: toolName, input, nodes };
}

// ── HAS_CONTENT_KEYS export ───────────────────────────────────────────────────

describe("HAS_CONTENT_KEYS", () => {
  it("includes has_content and hasContent", () => {
    expect(HAS_CONTENT_KEYS).toContain("has_content");
    expect(HAS_CONTENT_KEYS).toContain("hasContent");
  });
});

// ── readContentFlag ───────────────────────────────────────────────────────────

describe("readContentFlag — has_content tri-state", () => {
  it("true → returns true", () => {
    expect(readContentFlag({ has_content: true })).toBe(true);
  });

  it("false → returns false (NOT undefined)", () => {
    expect(readContentFlag({ has_content: false })).toBe(false);
  });

  it("absent → returns undefined (falls through to CONTENT_KEYS)", () => {
    expect(readContentFlag({ name: "x" })).toBeUndefined();
  });

  it("non-boolean string → returns undefined", () => {
    expect(readContentFlag({ has_content: "true" })).toBeUndefined();
  });

  it("non-boolean number → returns undefined", () => {
    expect(readContentFlag({ has_content: 1 })).toBeUndefined();
  });

  it("null → returns undefined", () => {
    expect(readContentFlag({ has_content: null })).toBeUndefined();
  });

  it("camelCase hasContent: true → returns true", () => {
    expect(readContentFlag({ hasContent: true })).toBe(true);
  });

  it("camelCase hasContent: false → returns false", () => {
    expect(readContentFlag({ hasContent: false })).toBe(false);
  });
});

describe("has_content tri-state in normalizeNode (via readToolActivity)", () => {
  it("has_content: true → retrievalBasis: content", () => {
    const concepts = (HAS_CONTENT_TRUE.concepts ?? {}) as Record<string, unknown>;
    const res = readToolActivity(concepts, DEFAULT_ROSTER);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.hasContent).toBe(true);
    expect(node.retrievalBasis).toBe("content");
  });

  it("has_content: false → does NOT set retrievalBasis: content", () => {
    const concepts = (HAS_CONTENT_FALSE.concepts ?? {}) as Record<string, unknown>;
    const res = readToolActivity(concepts, DEFAULT_ROSTER);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.hasContent).toBe(false);
    // graph_get is retrieval-class → tool-class basis, not content
    expect(node.retrievalBasis).toBe("tool-class");
  });

  it("has_content: absent → existing CONTENT_KEYS behaviour unchanged", () => {
    const concepts = (HAS_CONTENT_ABSENT.concepts ?? {}) as Record<string, unknown>;
    const res = readToolActivity(concepts, DEFAULT_ROSTER);
    const node = res.groups[0].calls[0].nodes[0];
    // No has_content key, no CONTENT_KEYS fields → hasContent: false
    expect(node.hasContent).toBe(false);
    // graph_get → tool-class
    expect(node.retrievalBasis).toBe("tool-class");
  });
});

// ── mergeIdentityRows extraction ──────────────────────────────────────────────

describe("mergeIdentityRows — extraction regression", () => {
  it("bare ref_id row and URN counterpart merge to same canonical key regardless of input order", () => {
    const base: NodeIdentityRow = {
      canonicalKey: "node-A",
      identity: "node-A",
      identityKind: "ref_id",
      name: "test",
      nodeType: "Concept",
      runStatus: "surfaced",
      runBasis: null,
      agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" }],
      hasOffScreenEvidence: false,
    };
    const urn: NodeIdentityRow = {
      canonicalKey: "kg/Concept/node-A",
      identity: "urn:acme:kg:ws1:Concept:node-A",
      identityKind: "urn",
      name: "test",
      nodeType: "Concept",
      runStatus: "retrieved",
      runBasis: "tool-class",
      agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 1, status: "retrieved", basis: "tool-class" }],
      hasOffScreenEvidence: false,
    };

    const resultAB = mergeIdentityRows([base, urn]);
    const resultBA = mergeIdentityRows([urn, base]);

    expect(resultAB).toHaveLength(1);
    expect(resultBA).toHaveLength(1);
    // Both orderings produce the same canonical key (the URN form)
    expect(resultAB[0].canonicalKey).toBe(resultBA[0].canonicalKey);
    expect(resultAB[0].identity).toBe("urn:acme:kg:ws1:Concept:node-A");
    expect(resultBA[0].identity).toBe("urn:acme:kg:ws1:Concept:node-A");
  });

  it("existing buildNodeIdentities assertions stay green after mergeIdentityRows extraction", () => {
    // Regression bar: a call that surfaces via graph_search and is later
    // retrieved via graph_get must produce one row with runStatus "retrieved"
    const records = [
      singleCall("graph_search", [{ ref_id: "node-A", node_type: "Concept", name: "A" }]),
      singleCall("graph_get", [{ ref_id: "node-A", node_type: "Concept", name: "A", properties: { x: 1 } }]),
    ];
    const res = runActivity(records);
    const ids = buildNodeIdentities(res.groups);
    expect(ids).toHaveLength(1);
    expect(ids[0].identity).toBe("node-A");
    expect(ids[0].runStatus).toBe("retrieved");
  });
});

// ── readBundleNodeIdentities — absent ─────────────────────────────────────────

describe("readBundleNodeIdentities — absent (no container key)", () => {
  it("returns reason: absent when concepts has no node_identities key", () => {
    const result = readBundleNodeIdentities({}, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("absent");
  });

  it("returns reason: absent for non-record input", () => {
    const result = readBundleNodeIdentities(null, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("absent");
  });
});

// ── readBundleNodeIdentities — malformed-shape ────────────────────────────────

describe("readBundleNodeIdentities — malformed-shape", () => {
  it("wrong top-level type → malformed-shape", () => {
    const result = readBundleNodeIdentities(MALFORMED_WRONG_TYPE, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("malformed-shape");
  });

  it("empty array → malformed-shape", () => {
    const result = readBundleNodeIdentities(MALFORMED_EMPTY_ARRAY, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("malformed-shape");
  });
});

// ── readBundleNodeIdentities — missing-agents ─────────────────────────────────

describe("readBundleNodeIdentities — missing-agents", () => {
  it("missing agents[] → missing-agents", () => {
    const result = readBundleNodeIdentities(MALFORMED_MISSING_AGENTS, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("missing-agents");
  });

  it("empty agents[] → missing-agents", () => {
    const result = readBundleNodeIdentities(MALFORMED_EMPTY_AGENTS, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("missing-agents");
  });

  it("malformed agent entry (missing count) → missing-agents", () => {
    const result = readBundleNodeIdentities(MALFORMED_MISSING_AGENTS, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("missing-agents");
  });
});

// ── readBundleNodeIdentities — unresolvable-identity-kind ────────────────────

describe("readBundleNodeIdentities — unresolvable-identity-kind", () => {
  it("unknown identity_kind string → unresolvable-identity-kind", () => {
    const result = readBundleNodeIdentities(MALFORMED_BAD_IDENTITY_KIND, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("unresolvable-identity-kind");
  });

  it("missing identity_kind → unresolvable-identity-kind", () => {
    const result = readBundleNodeIdentities(MALFORMED_MISSING_IDENTITY_KIND, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("unresolvable-identity-kind");
  });

  it("urn:-prefixed identity with identity_kind !== 'urn' → unresolvable-identity-kind", () => {
    const result = readBundleNodeIdentities(MALFORMED_URN_WRONG_KIND, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("unresolvable-identity-kind");
  });
});

// ── readBundleNodeIdentities — inconsistent-status ───────────────────────────

describe("readBundleNodeIdentities — inconsistent-status", () => {
  it("retrieved run_status with null run_basis → inconsistent-status", () => {
    const result = readBundleNodeIdentities(MALFORMED_RETRIEVED_NULL_BASIS, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("inconsistent-status");
  });

  it("surfaced run_status with non-null run_basis → inconsistent-status", () => {
    const result = readBundleNodeIdentities(MALFORMED_SURFACED_WITH_BASIS, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("inconsistent-status");
  });

  it("retrieved run_status but no agent has retrieved status → inconsistent-status", () => {
    const result = readBundleNodeIdentities(MALFORMED_RETRIEVED_NO_AGENT_RETRIEVED, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("inconsistent-status");
  });
});

// ── readBundleNodeIdentities — key-collision ──────────────────────────────────

describe("readBundleNodeIdentities — key-collision", () => {
  it("two rows sharing canonical key after merge → key-collision", () => {
    const result = readBundleNodeIdentities(MALFORMED_KEY_COLLISION, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("key-collision");
  });
});

// ── readBundleNodeIdentities — cap-divergence ─────────────────────────────────

describe("readBundleNodeIdentities — cap-divergence", () => {
  it("callsPerAgent truncation → cap-divergence", () => {
    const limits = { ...NO_CAP_LIMITS, callsPerAgentTruncated: true };
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, limits);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("cap-divergence");
  });

  it("nodesPerCall truncation → cap-divergence", () => {
    const limits = { ...NO_CAP_LIMITS, nodesPerCallTruncated: true };
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, limits);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("cap-divergence");
  });

  it("row count exceeds arrayCapRows → cap-divergence", () => {
    const limits = { ...NO_CAP_LIMITS, arrayCapRows: 1 }; // golden has 6 rows
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, limits);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("cap-divergence");
  });

  it("cap boundary test via runActivity with caps 2/2 (Hive's own invariant)", () => {
    // Cap behaviour is Hive's own invariant — bundle facts are only trusted when
    // no Hive cap applied. This test does not anchor to any external producer suite.
    const records = Array.from({ length: 5 }, (_, i) =>
      singleCall("graph_get", [
        { ref_id: `cap-node-${i}`, node_type: "Concept", name: `Cap ${i}`, properties: { x: i } },
      ]),
    );
    const res = runActivity(records, DEFAULT_ROSTER, 2, 10); // callsPerAgentCap=2
    // At least one agent hit the cap
    const wasTruncated = res.truncated.callsPerAgent.some((n) => n > 0);
    expect(wasTruncated).toBe(true);

    // A bundle carrying node_identities should be rejected when caps fired.
    const bundleWithIds = {
      node_identities: [
        {
          identity: "cap-node-0",
          identity_kind: "ref_id",
          name: "Cap 0",
          node_type: "Concept",
          run_status: "retrieved",
          run_basis: "tool-class",
          agents: [
            { agentKey: "cross_check_agent", count: 1, status: "retrieved", basis: "tool-class" },
          ],
        },
      ],
    };
    const limits = {
      arrayCapRows: 1000,
      callsPerAgentTruncated: res.truncated.callsPerAgent.some((n) => n > 0),
      nodesPerCallTruncated: res.truncated.nodesPerCall > 0,
    };
    const readResult = readBundleNodeIdentities(bundleWithIds, DEFAULT_ROSTER, limits);
    expect(readResult.rows).toBeNull();
    expect(readResult.reason).toBe("cap-divergence");
  });
});

// ── Drift test (requirement 5 — foreign-authored golden fixture) ──────────────

describe("drift test — derived-concepts-golden.ts (hand-authored, foreign data)", () => {
  it("readBundleNodeIdentities accepts and parses all golden rows", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    expect(result.rows).not.toBeNull();
    // 6 input rows: 5 rows + row 4's unknown_agent_xyz collapses to __unattributed__
    // After mergeIdentityRows: 6 distinct canonical keys (no URN/bare-id pair in golden)
    expect(result.rows!.length).toBe(GOLDEN_NODE_IDENTITIES.length);
  });

  it("unattributed agent key collapses to __unattributed__ group", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    // Row 4 has agent "unknown_agent_xyz" which is not in GOLDEN_ROSTER
    const row = result.rows!.find((r) => r.identity === "node-unattr-02");
    expect(row).toBeDefined();
    expect(row!.agents).toHaveLength(1);
    expect(row!.agents[0].agentKey).toBe("__unattributed__");
    expect(row!.agents[0].agentName).toBe("Unattributed");
  });

  it("rows sharing display name produce distinct identities (no merging)", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    const sharedNameRows = result.rows!.filter((r) => r.name === "shared_concept");
    // Two distinct rows with same name (ref_id "node-shared-A" and URN "shared-B")
    expect(sharedNameRows.length).toBe(2);
  });

  it("URN row has identityKind: urn", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    const urnRow = result.rows!.find((r) => r.identity === "urn:acme:kg:ws1:Concept:law-001");
    expect(urnRow?.identityKind).toBe("urn");
    expect(urnRow?.runStatus).toBe("retrieved");
  });

  it("bare ref_id row has identityKind: ref_id", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    const refRow = result.rows!.find((r) => r.identity === "node-surf-01");
    expect(refRow?.identityKind).toBe("ref_id");
    expect(refRow?.runStatus).toBe("surfaced");
  });

  it("multi-agent row has both agents present with correct statuses", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    const multiRow = result.rows!.find((r) => r.identity === "urn:acme:kg:ws1:Concept:clause-777");
    expect(multiRow?.agents).toHaveLength(2);
    const agentA = multiRow!.agents.find((a) => a.agentKey === "cross_check_agent");
    const agentB = multiRow!.agents.find((a) => a.agentKey === "drafter");
    expect(agentA?.status).toBe("retrieved");
    expect(agentB?.status).toBe("surfaced");
  });

  it("hasOffScreenEvidence is false on all bundle rows", () => {
    const result = readBundleNodeIdentities(DERIVED_CONCEPTS_GOLDEN, GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    for (const row of result.rows!) {
      expect(row.hasOffScreenEvidence).toBe(false);
    }
  });
});

// ── Round-trip test (requirement 5 via forceSource) ───────────────────────────

describe("round-trip test — with-derived-concepts.ts + forceSource seam", () => {
  const concepts = (WITH_DERIVED_CONCEPTS.concepts ?? {}) as Record<string, unknown>;
  const rosterForFixture = rosterMap("cross_check_agent", "drafter");

  it("both engines produce the same identity rows (positive allowlist)", () => {
    const rawRecords = (concepts.tool_activity as unknown[]) ?? [];
    const taResult = readToolActivity(concepts, rosterForFixture);
    const groups = taResult.groups;

    const bundleResult = selectNodeIdentities(
      concepts,
      groups,
      rosterForFixture,
      NO_CAP_LIMITS,
      { forceSource: "bundle" },
    );
    const derivedResult = selectNodeIdentities(
      concepts,
      groups,
      rosterForFixture,
      NO_CAP_LIMITS,
      { forceSource: "derived" },
    );

    expect(bundleResult.source).toBe("bundle");
    expect(derivedResult.source).toBe("derived");

    const bIds = [...bundleResult.identities].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
    const dIds = [...derivedResult.identities].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));

    expect(bIds.length).toBe(dIds.length);

    // Positive allowlist of compared fields (not deep-equal-minus-exceptions).
    // Exclusion: unattributedRecordCount is 0 on bundle rows (no record-level
    // grouping) — bundle source preserves "derived" group membership logic.
    for (let i = 0; i < bIds.length; i++) {
      const b = bIds[i];
      const d = dIds[i];
      expect(b.canonicalKey).toBe(d.canonicalKey);
      expect(b.identity).toBe(d.identity);
      expect(b.identityKind).toBe(d.identityKind);  // ✓ in allowlist
      expect(b.name).toBe(d.name);
      expect(b.nodeType).toBe(d.nodeType);
      expect(b.runStatus).toBe(d.runStatus);          // ✓ in allowlist
      expect(b.runBasis).toBe(d.runBasis);            // ✓ in allowlist
      expect(b.hasOffScreenEvidence).toBe(d.hasOffScreenEvidence); // ✓ in allowlist

      // agents[] — compare by agentKey
      const bAgentKeys = b.agents.map((a) => a.agentKey).sort();
      const dAgentKeys = d.agents.map((a) => a.agentKey).sort();
      expect(bAgentKeys).toEqual(dAgentKeys);

      for (const bAgent of b.agents) {
        const dAgent = d.agents.find((a) => a.agentKey === bAgent.agentKey);
        expect(dAgent).toBeDefined();
        expect(bAgent.status).toBe(dAgent!.status);   // ✓ in allowlist
        expect(bAgent.basis).toBe(dAgent!.basis);     // ✓ in allowlist
      }
    }
    void rawRecords; // suppress unused variable
  });
});

// ── deriveTopConcepts ─────────────────────────────────────────────────────────

describe("deriveTopConcepts — byName vs perIdentity", () => {
  it("name-collision: byName merges into 1, perIdentity keeps 2", () => {
    const concepts = (NAME_COLLISION.concepts ?? {}) as Record<string, unknown>;
    const res = readToolActivity(concepts, DEFAULT_ROSTER);
    const ids = buildNodeIdentities(res.groups);

    const { byName, perIdentity } = deriveTopConcepts(ids);

    // Two identities sharing "shared_concept" should merge in byName
    const byNameConcepts = byName.filter((p) => p.name === "shared_concept");
    expect(byNameConcepts).toHaveLength(1);

    // perIdentity keeps both distinct rows
    const perIdConcepts = perIdentity.filter((p) => p.name === "shared_concept");
    expect(perIdConcepts).toHaveLength(2);
  });

  it("deterministic ordering: equal-total concepts rank stably", () => {
    // Two retrieved Concept rows with equal total counts
    const rows: NodeIdentityRow[] = [
      {
        canonicalKey: "beta",
        identity: "beta",
        identityKind: "ref_id",
        name: "Beta Concept",
        nodeType: "Concept",
        runStatus: "retrieved",
        runBasis: "tool-class",
        agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 2, status: "retrieved", basis: "tool-class" }],
        hasOffScreenEvidence: false,
      },
      {
        canonicalKey: "alpha",
        identity: "alpha",
        identityKind: "ref_id",
        name: "Alpha Concept",
        nodeType: "Concept",
        runStatus: "retrieved",
        runBasis: "tool-class",
        agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 2, status: "retrieved", basis: "tool-class" }],
        hasOffScreenEvidence: false,
      },
    ];

    const { byName: r1 } = deriveTopConcepts(rows);
    const { byName: r2 } = deriveTopConcepts([...rows].reverse());

    // Both orderings of input must produce the same ranked output
    expect(r1.map((p) => p.name)).toEqual(r2.map((p) => p.name));
  });

  it("surfaced-only nodes do NOT appear in byName or perIdentity", () => {
    const rows: NodeIdentityRow[] = [
      {
        canonicalKey: "surf",
        identity: "surf",
        identityKind: "ref_id",
        name: "Surfaced Node",
        nodeType: "Concept",
        runStatus: "surfaced",
        runBasis: null,
        agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" }],
        hasOffScreenEvidence: false,
      },
    ];
    const { byName, perIdentity } = deriveTopConcepts(rows);
    expect(byName).toHaveLength(0);
    expect(perIdentity).toHaveLength(0);
  });

  it("non-Concept node types do NOT appear in concepts lists", () => {
    const rows: NodeIdentityRow[] = [
      {
        canonicalKey: "doc-X",
        identity: "doc-X",
        identityKind: "ref_id",
        name: "A Document",
        nodeType: "Document",
        runStatus: "retrieved",
        runBasis: "content",
        agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 1, status: "retrieved", basis: "content" }],
        hasOffScreenEvidence: false,
      },
    ];
    const { byName, perIdentity } = deriveTopConcepts(rows);
    expect(byName).toHaveLength(0);
    expect(perIdentity).toHaveLength(0);
  });
});

// ── deriveAllSurfacedHint — both denominators ─────────────────────────────────

describe("deriveAllSurfacedHint — both denominators pinned", () => {
  it("ontology-only run (none-class): empty identities → all-calls denominator, hint=false", () => {
    // No identified nodes at all (graph_ontology returns none-class nodes only).
    // The all-calls denominator fires: totalIdentities=0 → hint does NOT fire.
    const concepts = (ONTOLOGY_ONLY.concepts ?? {}) as Record<string, unknown>;
    const res = readToolActivity(concepts, DEFAULT_ROSTER);
    const ids = buildNodeIdentities(res.groups);
    expect(ids).toHaveLength(0); // none-class → no identities
    expect(deriveAllSurfacedHint(ids, res.groups)).toBe(false);
  });

  it("surfaced-only run: identities present but none retrieved → identity-set denominator, hint=true", () => {
    const records = [
      singleCall("graph_search", [{ ref_id: "s1", node_type: "Concept", name: "surfaced" }]),
    ];
    const res = runActivity(records);
    const ids = buildNodeIdentities(res.groups);
    expect(ids.length).toBeGreaterThan(0);
    expect(deriveAllSurfacedHint(ids, res.groups)).toBe(true);
  });

  it("ontology-only WITH node_identities: identity-set denominator, hint=false (retrieved identity)", () => {
    // When node_identities are present (from bundle), deriveAllSurfacedHint
    // uses the identity-set denominator. The ONTOLOGY_WITH_IDENTITIES fixture
    // carries one retrieved identity → hint must NOT fire.
    const concepts = (ONTOLOGY_WITH_IDENTITIES.concepts ?? {}) as Record<string, unknown>;
    const taRes = readToolActivity(concepts, DEFAULT_ROSTER);
    const bundleRead = readBundleNodeIdentities(concepts, DEFAULT_ROSTER, NO_CAP_LIMITS);
    const ids = bundleRead.reason === null ? bundleRead.rows! : buildNodeIdentities(taRes.groups);
    expect(deriveAllSurfacedHint(ids, taRes.groups)).toBe(false);
  });

  it("retrieved run: some identities retrieved → hint=false", () => {
    const records = [
      singleCall("graph_get", [{ ref_id: "r1", node_type: "Concept", name: "N", properties: { x: 1 } }]),
    ];
    const res = runActivity(records);
    const ids = buildNodeIdentities(res.groups);
    expect(deriveAllSurfacedHint(ids, res.groups)).toBe(false);
  });
});

// ── compareTopConcepts ────────────────────────────────────────────────────────

describe("compareTopConcepts", () => {
  const derived = [
    { name: "Concept A", nodeType: "Concept", total: 3, agents: [], refId: null },
    { name: "Concept B", nodeType: "Concept", total: 1, agents: [], refId: null },
  ];

  it("returns false when no top_concepts key", () => {
    expect(compareTopConcepts({}, derived)).toBe(false);
  });

  it("returns false when key sets are identical (order-insensitive)", () => {
    const raw = {
      top_concepts: [
        { node_type: "Concept", name: "Concept B" },
        { node_type: "Concept", name: "Concept A" },
      ],
    };
    expect(compareTopConcepts(raw, derived)).toBe(false);
  });

  it("returns false when lists differ only in totals/slice", () => {
    const raw = {
      top_concepts: [
        { node_type: "Concept", name: "Concept A", total: 99 },
        { node_type: "Concept", name: "Concept B", total: 0 },
      ],
    };
    expect(compareTopConcepts(raw, derived)).toBe(false);
  });

  it("returns true when key sets differ (bundle has extra concept)", () => {
    const raw = {
      top_concepts: [
        { node_type: "Concept", name: "Concept A" },
        { node_type: "Concept", name: "Concept C" }, // not in derived
      ],
    };
    expect(compareTopConcepts(raw, derived)).toBe(true);
  });

  it("returns true when bundle has fewer concepts than derived", () => {
    const raw = {
      top_concepts: [
        { node_type: "Concept", name: "Concept A" }, // missing B
      ],
    };
    expect(compareTopConcepts(raw, derived)).toBe(true);
  });
});

// ── selectNodeIdentities — presence detection ─────────────────────────────────

describe("selectNodeIdentities — presence detection", () => {
  it("falls back to derived when no bundle field present", () => {
    const rawConcepts = { tool_activity: [] };
    const result = selectNodeIdentities(rawConcepts, [], DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.source).toBe("derived");
    expect(result.reason).toBeNull();
  });

  it("uses bundle when node_identities present and valid (golden fixture)", () => {
    const result = selectNodeIdentities(DERIVED_CONCEPTS_GOLDEN, [], GOLDEN_ROSTER, NO_CAP_LIMITS);
    expect(result.source).toBe("bundle");
    expect(result.reason).toBeNull();
    expect(result.identities.length).toBeGreaterThan(0);
  });

  it("falls back with rejection reason on malformed bundle", () => {
    const result = selectNodeIdentities(MALFORMED_EMPTY_ARRAY, [], DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.source).toBe("derived");
    expect(result.reason).toBe("malformed-shape");
  });

  it("forceSource: bundle drives bundle engine", () => {
    const result = selectNodeIdentities(
      DERIVED_CONCEPTS_GOLDEN,
      [],
      GOLDEN_ROSTER,
      NO_CAP_LIMITS,
      { forceSource: "bundle" },
    );
    expect(result.source).toBe("bundle");
  });

  it("forceSource: derived drives derived engine even when bundle is valid", () => {
    const result = selectNodeIdentities(
      DERIVED_CONCEPTS_GOLDEN,
      [],
      GOLDEN_ROSTER,
      NO_CAP_LIMITS,
      { forceSource: "derived" },
    );
    expect(result.source).toBe("derived");
    expect(result.reason).toBeNull();
  });
});

// ── refId shape validation ────────────────────────────────────────────────────

describe("refId shape validation", () => {
  it("ref_id with slash in identity → malformed-shape (security: no path-traversal)", () => {
    const malformed = {
      node_identities: [
        {
          identity: "../../etc/passwd",
          identity_kind: "ref_id",
          name: "evil",
          node_type: "Concept",
          run_status: "surfaced",
          run_basis: null,
          agents: [{ agentKey: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" }],
        },
      ],
    };
    const result = readBundleNodeIdentities(malformed, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.rows).toBeNull();
    expect(result.reason).toBe("malformed-shape");
  });

  it("valid ref_id identity passes", () => {
    const valid = {
      node_identities: [
        {
          identity: "node-abc-123",
          identity_kind: "ref_id",
          name: "ok",
          node_type: "Concept",
          run_status: "surfaced",
          run_basis: null,
          agents: [{ agentKey: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" }],
        },
      ],
    };
    const result = readBundleNodeIdentities(valid, DEFAULT_ROSTER, NO_CAP_LIMITS);
    expect(result.reason).toBeNull();
    expect(result.rows).not.toBeNull();
  });
});
