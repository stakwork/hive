import { describe, expect, it } from "vitest";
import { countByKind, matchesKind, parseKindFilter } from "@/lib/system-map/finding-kind";

const list = [{ kind: "code" }, { kind: "dependency" }, { kind: "dependency" }, { kind: "config" }, { kind: null }, {}];

describe("finding kind filter", () => {
  it("parses the query value, defaulting to all", () => {
    expect(parseKindFilter("dependency")).toBe("dependency");
    expect(parseKindFilter("unspecified")).toBe("unspecified");
    expect(parseKindFilter("bogus")).toBe("all");
    expect(parseKindFilter(null)).toBe("all");
  });

  it("filters by kind, treating missing kind as unspecified", () => {
    expect(list.filter((f) => matchesKind(f, "all"))).toHaveLength(6);
    expect(list.filter((f) => matchesKind(f, "dependency"))).toHaveLength(2);
    expect(list.filter((f) => matchesKind(f, "unspecified"))).toHaveLength(2);
  });

  it("counts per kind", () => {
    expect(countByKind(list)).toEqual({ all: 6, code: 1, dependency: 2, config: 1, unspecified: 2 });
  });
});
