import { describe, it, expect } from "vitest";
import {
  parseImageVersions,
  shouldShowUpdateAvailable,
  normalizeServiceName,
  type ImageVersion,
} from "@/app/admin/swarms/[instanceId]/image-versions";

const SPHINX: ImageVersion = {
  name: "sphinx",
  version: "1.0.0",
  is_latest: false,
  latest_version: "1.2.0",
};
const NEO4J: ImageVersion = {
  name: "neo4j",
  version: "5",
  is_latest: true,
  latest_version: "5",
};
const ORPHAN: ImageVersion = {
  name: "orphan",
  version: "9.9.9",
  is_latest: false,
  latest_version: "10.0.0",
};

function mapKeys(map: Map<string, ImageVersion>) {
  return [...map.keys()];
}

describe("normalizeServiceName", () => {
  it('strips a trailing ".sphinx" suffix', () => {
    expect(normalizeServiceName("boltwall.sphinx")).toBe("boltwall");
  });

  it('aliases "sphinx-swarm" to "swarm"', () => {
    expect(normalizeServiceName("sphinx-swarm")).toBe("swarm");
  });

  it("leaves unrelated names unchanged", () => {
    expect(normalizeServiceName("redis")).toBe("redis");
  });

  it('does not empty the live table default name "sphinx"', () => {
    expect(normalizeServiceName("sphinx")).toBe("sphinx");
  });

  it('does not alias "swarm" unless the full "sphinx-swarm" token is present', () => {
    expect(normalizeServiceName("swarm")).toBe("swarm");
  });

  it("strips a leading slash then a trailing .sphinx suffix", () => {
    expect(normalizeServiceName("/boltwall.sphinx")).toBe("boltwall");
  });

  it('returns empty string for a name that is only ".sphinx"', () => {
    expect(normalizeServiceName(".sphinx")).toBe("");
  });
});

describe("parseImageVersions", () => {
  it("parses the { success, message, data } envelope into a name→version map", () => {
    const map = parseImageVersions({
      success: true,
      message: "image versions retrieved",
      data: [SPHINX, NEO4J, ORPHAN],
    });

    expect(map.size).toBe(3);
    expect(map.get("sphinx")).toEqual(SPHINX);
    expect(map.get("neo4j")).toEqual(NEO4J);
    expect(map.get("orphan")).toEqual(ORPHAN);
  });

  it("parses a bare ImageVersion array", () => {
    const map = parseImageVersions([SPHINX, NEO4J]);

    expect(map.size).toBe(2);
    expect(map.get("sphinx")).toEqual(SPHINX);
    expect(map.get("neo4j")).toEqual(NEO4J);
  });

  it("skips entries with missing or empty name", () => {
    const map = parseImageVersions([
      { version: "1", is_latest: false, latest_version: "2" },
      { name: "", version: "1", is_latest: false, latest_version: "2" },
      SPHINX,
    ]);

    expect(mapKeys(map)).toEqual(["sphinx"]);
  });

  it("keys the map by the normalized name while keeping the raw ImageVersion.name", () => {
    const suffixed: ImageVersion = {
      name: "boltwall.sphinx",
      version: "1.0.0",
      is_latest: false,
      latest_version: "1.2.0",
    };
    const map = parseImageVersions([suffixed]);

    expect(map.get("boltwall")).toEqual(suffixed);
    expect(map.get("boltwall")?.name).toBe("boltwall.sphinx");
    expect(map.has("boltwall.sphinx")).toBe(false);
  });

  it("omits entries whose normalized key is empty", () => {
    const map = parseImageVersions([
      { name: ".sphinx", version: "1", is_latest: false, latest_version: "2" },
      SPHINX,
    ]);

    expect(mapKeys(map)).toEqual(["sphinx"]);
    expect(map.has("")).toBe(false);
  });

  it("keeps unmatched names in the map", () => {
    const map = parseImageVersions([SPHINX, ORPHAN]);

    expect(map.has("orphan")).toBe(true);
    expect(map.get("orphan")).toEqual(ORPHAN);
  });

  it("returns an empty map for a name-keyed record", () => {
    const map = parseImageVersions({
      sphinx: "1.0.0",
      neo4j: "5",
    });

    expect(map.size).toBe(0);
  });

  it("returns an empty map for the legacy { images: { name: tag } } shape", () => {
    const map = parseImageVersions({
      images: {
        "sphinxlightning/sphinx-relay": "latest",
        neo4j: "5",
      },
    });

    expect(map.size).toBe(0);
  });
});

describe("shouldShowUpdateAvailable", () => {
  it("returns false for undefined and null", () => {
    expect(shouldShowUpdateAvailable(undefined)).toBe(false);
    expect(shouldShowUpdateAvailable(null)).toBe(false);
  });

  it("returns false when version or latest_version is missing/empty", () => {
    expect(
      shouldShowUpdateAvailable({
        name: "sphinx",
        version: "",
        is_latest: false,
        latest_version: "1.2.0",
      })
    ).toBe(false);
    expect(
      shouldShowUpdateAvailable({
        name: "sphinx",
        version: "1.0.0",
        is_latest: false,
        latest_version: "",
      })
    ).toBe(false);
  });

  it("returns false when version or latest_version is the unavailable sentinel", () => {
    expect(
      shouldShowUpdateAvailable({
        name: "lnd",
        version: "unavailable",
        is_latest: false,
        latest_version: "v0.18",
      })
    ).toBe(false);
    expect(
      shouldShowUpdateAvailable({
        name: "lnd",
        version: "v0.17",
        is_latest: false,
        latest_version: "unavailable",
      })
    ).toBe(false);
  });

  it("returns false when is_latest is truthy", () => {
    expect(shouldShowUpdateAvailable(NEO4J)).toBe(false);
  });

  it("returns true when is_latest is falsy and both version fields are known", () => {
    expect(shouldShowUpdateAvailable(SPHINX)).toBe(true);
  });
});
