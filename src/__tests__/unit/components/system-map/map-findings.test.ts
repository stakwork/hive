/**
 * Unit tests for findings on the Map view (`DomainNodesTab/map-findings.ts`):
 * placing a finding on its component by file path, on nodes declared in its
 * file, lighting its related nodes once they are read, and the path a
 * vulnerable package takes into the system.
 */

import { describe, it, expect } from "vitest";
import { buildMapLayout } from "@/components/system-map/DomainNodesTab/map-layout";
import {
  buildMapFindingIndex,
  componentForPath,
  findingHighlight,
  findingPackagePaths,
  findingSeverityRank,
} from "@/components/system-map/DomainNodesTab/map-findings";
import type {
  SystemMapDomainEdge,
  SystemMapDomainNode,
  SystemMapFinding,
  SystemMapFindingRelated,
} from "@/types/system-map";

function node(refId: string, type: string, properties: Record<string, unknown> = {}): SystemMapDomainNode {
  return { refId, type, name: (properties.name as string) ?? refId, properties };
}
function edge(source: string, edgeType: string, target: string): SystemMapDomainEdge {
  return { source, target, edgeType };
}
function finding(refId: string, file: string | null, severity: string | null = "high"): SystemMapFinding {
  return {
    refId,
    title: refId,
    severity,
    status: null,
    cweId: null,
    file,
    line: null,
    description: null,
    dateAdded: null,
    properties: {},
  };
}
function related(
  refId: string,
  nodeType: string,
  extra: Partial<SystemMapFindingRelated> = {},
): SystemMapFindingRelated {
  return { refId, nodeType, edgeType: "ABOUT", direction: "out", name: refId, file: null, properties: {}, ...extra };
}

const NODES = [
  node("internal", "SysTrustZone", { name: "internal" }),
  node("peel", "SysComponent", { name: "stakwork/peel", kind: "frontend" }),
  node("brain", "SysComponent", { name: "stakwork/peel/brain", kind: "service" }),
  node("cli", "SysInterface", {
    name: "stakwork/peel cli peel",
    kind: "cli",
    source_path: "stakwork/peel/Package.swift",
  }),
  node("tokio", "SysPackage", { name: "tokio", version: "1.0.0", ecosystem: "crates.io" }),
];
const EDGES = [
  edge("peel", "RUNS_IN", "internal"),
  edge("brain", "RUNS_IN", "internal"),
  edge("peel", "EXPOSES", "cli"),
  edge("brain", "DEPENDS_ON", "tokio"),
];
const MODEL = buildMapLayout(NODES, EDGES);

describe("componentForPath", () => {
  const components = [
    { id: "brain", path: "stakwork/peel/brain" },
    { id: "peel", path: "stakwork/peel" },
  ];
  it("picks the component with the longest name that prefixes the path", () => {
    expect(componentForPath("stakwork/peel/brain/src/db.rs", components)).toBe("brain");
    expect(componentForPath("stakwork/peel/Sources/App.swift", components)).toBe("peel");
    expect(componentForPath("./stakwork/peel/brain", components)).toBe("brain");
  });
  it("does not match a sibling that only shares a prefix of characters", () => {
    expect(componentForPath("stakwork/peeling/x.ts", components)).toBeNull();
    expect(componentForPath(null, components)).toBeNull();
  });
});

describe("buildMapFindingIndex", () => {
  it("files findings under their component, worst first, and anchors nodes declared in the same file", () => {
    const index = buildMapFindingIndex(
      [
        finding("f-low", "stakwork/peel/brain/src/db.rs", "low"),
        finding("f-crit", "stakwork/peel/brain/src/api.rs", "critical"),
        finding("f-cli", "stakwork/peel/Package.swift", "medium"),
        finding("f-none", "elsewhere/x.py"),
        finding("f-nofile", null),
      ],
      MODEL,
    );
    expect(index.byComponent.get("brain")?.map((f) => f.refId)).toEqual(["f-crit", "f-low"]);
    expect(index.byComponent.get("peel")?.map((f) => f.refId)).toEqual(["f-cli"]);
    expect(index.anchors.get("f-cli")?.sort()).toEqual(["cli", "peel"]);
    expect(index.anchors.get("f-none")).toEqual([]);
    expect(index.unplaced).toBe(2);
  });
});

describe("findingHighlight", () => {
  it("lights the anchors, related map nodes and package chips, and lists the rest as off the map", () => {
    const f = finding("f", "stakwork/peel/brain/src/db.rs");
    const index = buildMapFindingIndex([f], MODEL);
    expect([...findingHighlight(f, index, MODEL, null).ids]).toEqual(["brain"]);

    const lit = findingHighlight(f, index, MODEL, [
      related("tokio", "SysPackage"),
      related("cwe-89", "CWE", { name: "CWE-89" }),
      related("file-1", "File", { file: "stakwork/peel/Sources/App.swift" }),
    ]);
    // tokio lights brain, which depends on it, as well as itself.
    expect([...lit.ids].sort()).toEqual(["brain", "peel", "tokio"]);
    expect(lit.offMap.map((r) => r.refId)).toEqual(["cwe-89", "file-1"]);
  });

  it("lights the component that depends on a package the finding is about", () => {
    const cve = finding("cve", null);
    const index = buildMapFindingIndex([cve], MODEL);
    expect([...findingHighlight(cve, index, MODEL, [related("tokio", "SysPackage")]).ids].sort()).toEqual([
      "brain",
      "tokio",
    ]);
  });
});

describe("findingPackagePaths", () => {
  const withChain = buildMapLayout(
    [
      ...NODES,
      node("express", "SysPackage", { name: "express", version: "4.21.2" }),
      node("proxy", "SysPackage", { name: "proxy-addr", version: "2.0.7" }),
    ],
    [
      ...EDGES,
      edge("brain", "DEPENDS_ON", "express"),
      edge("brain", "DEPENDS_ON", "proxy"),
      edge("express", "DEPENDS_ON", "proxy"),
    ],
  );
  const label = (path: { label: string }[]) => path.map((s) => s.label).join(" → ");

  it("runs from the component through the direct package down to the vulnerable one", () => {
    const cve = finding("cve", "stakwork/peel/brain/package-lock.json");
    const index = buildMapFindingIndex([cve], withChain);
    const paths = findingPackagePaths(cve, index, withChain, [related("proxy", "SysPackage")]);
    expect(paths.map(label)).toEqual(["stakwork/peel/brain → express@4.21.2 → proxy-addr@2.0.7"]);
    expect(paths[0].map((s) => [s.kind, s.placed])).toEqual([
      ["component", true],
      ["package", true],
      ["package", true],
    ]);
  });

  it("is the finding's component and the package alone when packages are not read", () => {
    const cve = finding("cve", "stakwork/peel/brain/package-lock.json");
    const index = buildMapFindingIndex([cve], MODEL);
    const paths = findingPackagePaths(cve, index, MODEL, [
      related("proxy", "SysPackage", { name: "proxy-addr", properties: { version: "2.0.7" } }),
    ]);
    expect(paths.map(label)).toEqual(["stakwork/peel/brain → proxy-addr@2.0.7"]);
    expect(paths[0][1].placed).toBe(false);
  });

  it("uses the path walked in jarvis when the related read has one", () => {
    const cve = finding("cve", "stakwork/peel/brain/package-lock.json");
    const index = buildMapFindingIndex([cve], MODEL);
    const paths = findingPackagePaths(
      cve,
      index,
      MODEL,
      [related("proxy", "SysPackage")],
      [
        [
          { refId: "brain", nodeType: "SysComponent", name: "stakwork/peel/brain", version: null },
          { refId: "express", nodeType: "SysPackage", name: "express", version: "4.21.2" },
          { refId: "proxy", nodeType: "SysPackage", name: "proxy-addr", version: "2.0.7" },
        ],
      ],
    );
    expect(paths.map(label)).toEqual(["stakwork/peel/brain → express@4.21.2 → proxy-addr@2.0.7"]);
    expect(paths[0].map((s) => [s.kind, s.placed])).toEqual([
      ["component", true],
      ["package", false],
      ["package", false],
    ]);
  });

  it("is empty for a finding about no package", () => {
    const f = finding("f", "stakwork/peel/brain/src/db.rs");
    const index = buildMapFindingIndex([f], MODEL);
    expect(findingPackagePaths(f, index, MODEL, [related("cwe-89", "CWE")])).toEqual([]);
  });
});

describe("findingSeverityRank", () => {
  it("orders critical to info, then anything else", () => {
    const order = ["info", null, "HIGH", "critical", "weird", "medium", "low"].sort(
      (a, b) => findingSeverityRank(a) - findingSeverityRank(b),
    );
    expect(order).toEqual(["critical", "HIGH", "medium", "low", "info", null, "weird"]);
  });
});
