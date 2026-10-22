/**
 * Unit tests for the package CVE check's output model
 * (`DomainNodesTab/package-cves.ts`): parsing `vulnerable_packages` and
 * matching each finding to the Dependencies view's packages.
 */

import { describe, it, expect } from "vitest";
import { buildDependencies } from "@/components/system-map/DomainNodesTab/dependencies";
import { matchPackageCves, parsePackageCves, severityRank } from "@/components/system-map/DomainNodesTab/package-cves";
import type { SystemMapDomainNode } from "@/types/system-map";

function pkg(refId: string, name: string, version: string, ecosystem = "crates.io"): SystemMapDomainNode {
  return {
    refId,
    type: "SysPackage",
    name,
    properties: { name, version, ecosystem, id: `pkg:cargo/${name}@${version}` },
  };
}

const PACKAGES = buildDependencies(
  [
    pkg("qx", "quick-xml", "0.30.0"),
    pkg("tk", "tokio", "1.0.0"),
    pkg("sd", "serde", "1.0.0"),
    pkg("rg", "regex", "1.5.0"),
  ],
  [],
).packages;

const OUTPUT = {
  vulnerable_packages: [
    {
      name: "quick-xml",
      version: "0.30.0",
      ecosystem: "crates.io",
      purl: "pkg:cargo/quick-xml@0.30.0",
      ref_id: "qx",
      source_path: "stakwork/peel/Vendor/runner.Cargo.lock",
      source_line: 1860,
      severity: "HIGH",
      fixed_in: "0.41.0",
      advisories: [
        { id: "A-LOW", cves: [], severity: "LOW", cvss_score: 3.1, kind: "vuln", summary: "minor" },
        {
          id: "RUSTSEC-2026-0194",
          cves: ["CVE-2026-1"],
          severity: "HIGH",
          cvss_score: 7.5,
          kind: "vuln",
          summary: "…",
          fixed_in: "0.41.0",
          url: "https://osv.dev/x",
          published: "2026-01-02T00:00:00Z",
        },
      ],
      fetch_errors: [],
    },
    // Matched by purl: the ref_id is from an older graph.
    {
      name: "tokio",
      version: "1.0.0",
      ecosystem: "crates.io",
      purl: "pkg:cargo/tokio@1.0.0",
      ref_id: "old",
      severity: "critical",
      advisories: [],
    },
    // Matched by name, version and ecosystem.
    { name: "serde", version: "1.0.0", ecosystem: "Crates.io", severity: "MODERATE", advisories: [] },
    // Not in the graph.
    { name: "openssl", version: "0.10.0", ecosystem: "crates.io", ref_id: "gone", severity: "HIGH", advisories: [] },
  ],
};

describe("parsePackageCves", () => {
  it("is null for another workflow's output", () => {
    expect(parsePackageCves(null)).toBeNull();
    expect(parsePackageCves("report")).toBeNull();
    expect(parsePackageCves({ markdown: "x" })).toBeNull();
  });

  it("reads the findings, upper-cases severity and sorts advisories worst first", () => {
    const parsed = parsePackageCves(OUTPUT)!;
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toMatchObject({
      refId: "qx",
      severity: "HIGH",
      fixedIn: "0.41.0",
      sourcePath: "stakwork/peel/Vendor/runner.Cargo.lock",
    });
    expect(parsed[0].advisories.map((a) => a.id)).toEqual(["RUSTSEC-2026-0194", "A-LOW"]);
    expect(parsed[0].advisories[0]).toMatchObject({ cves: ["CVE-2026-1"], cvssScore: 7.5, url: "https://osv.dev/x" });
    expect(parsed[1].severity).toBe("CRITICAL");
  });

  it("takes the worst advisory's severity when the package has none", () => {
    const [p] = parsePackageCves({
      vulnerable_packages: [{ name: "x", advisories: [{ id: "A", severity: "medium" }] }],
    })!;
    expect(p.severity).toBe("MEDIUM");
  });
});

describe("matchPackageCves", () => {
  it("matches by ref_id, then purl, then name/version/ecosystem, and lists the rest as unmatched", () => {
    const report = matchPackageCves(parsePackageCves(OUTPUT)!, PACKAGES, "2026-10-22T00:00:00Z");
    expect([...report.byPackage.keys()].sort()).toEqual(["qx", "sd", "tk"]);
    expect(report.byPackage.get("tk")!.severity).toBe("CRITICAL");
    expect(report.byPackage.has("rg")).toBe(false);
    expect(report.unmatched.map((p) => p.name)).toEqual(["openssl"]);
  });

  it("keeps the worse finding when two match one package", () => {
    const report = matchPackageCves(
      parsePackageCves({
        vulnerable_packages: [
          { ref_id: "qx", name: "quick-xml", severity: "LOW", advisories: [] },
          { ref_id: "qx", name: "quick-xml", severity: "HIGH", advisories: [] },
        ],
      })!,
      PACKAGES,
      "t",
    );
    expect(report.byPackage.get("qx")!.severity).toBe("HIGH");
  });
});

describe("severityRank", () => {
  it("orders critical before high before moderate before low before unknown before none", () => {
    const order = ["LOW", undefined, "HIGH", "weird", "CRITICAL", "MODERATE"].sort(
      (a, b) => severityRank(a) - severityRank(b),
    );
    expect(order).toEqual(["CRITICAL", "HIGH", "MODERATE", "LOW", "weird", undefined]);
  });
});
