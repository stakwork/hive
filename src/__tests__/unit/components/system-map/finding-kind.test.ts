import { describe, expect, it } from "vitest";
import { summarizeFinding } from "@/components/system-map/FindingsTab/finding-kind";
import type { SystemMapFinding } from "@/types/system-map";

function finding(fields: Partial<SystemMapFinding>, properties: Record<string, unknown> = {}): SystemMapFinding {
  return {
    refId: "f1",
    title: "A finding",
    severity: "high",
    status: null,
    cweId: null,
    file: null,
    line: null,
    description: null,
    dateAdded: null,
    fix: null,
    properties,
    ...fields,
  };
}

describe("summarizeFinding", () => {
  it("reads a package CVE's ids, package and fix version", () => {
    const summary = summarizeFinding(
      finding(
        { file: "package-lock.json" },
        {
          cve_id: "CVE-2024-1",
          cves: ["CVE-2024-1", "CVE-2024-2"],
          package: "lodash",
          installed_version: "4.17.20",
          fixed_in: "4.17.21",
        },
      ),
    );
    expect(summary).toEqual({
      check: "cve",
      ids: ["CVE-2024-1", "CVE-2024-2"],
      pkg: "lodash@4.17.20",
      fixedIn: "4.17.21",
    });
  });

  it("takes advisory ids from objects and comma lists", () => {
    const summary = summarizeFinding(finding({}, { advisories: [{ id: "GHSA-1" }], cve: "CVE-1, CVE-2" }));
    expect(summary.ids).toEqual(["CVE-1", "CVE-2", "GHSA-1"]);
    expect(summary.pkg).toBeNull();
  });

  it("leads a code issue with its CWE", () => {
    const summary = summarizeFinding(finding({ cweId: "CWE-79", file: "src/a.ts", line: 3 }));
    expect(summary).toEqual({ check: "cwe", ids: ["CWE-79"], pkg: null, fixedIn: null });
  });

  it("takes the check from source_role", () => {
    const osv = finding({ cweId: "CWE-1321", file: "package-lock.json" }, { source_role: "osv-package-scan" });
    expect(summarizeFinding(osv).check).toBe("cve");
    expect(summarizeFinding(finding({}, { source_role: "cwe-template-check", cve_id: "CVE-1" })).check).toBe("cwe");
  });

  it("infers the check when there is no source_role", () => {
    expect(summarizeFinding(finding({}, { cve_id: "CVE-1" })).check).toBe("cve");
    expect(summarizeFinding(finding({ cweId: "CWE-79" })).check).toBe("cwe");
    expect(summarizeFinding(finding({})).check).toBe("cwe");
  });
});
