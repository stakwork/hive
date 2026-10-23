import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_TYPES,
  ON_DEMAND_NODE_TYPES,
  parseNodeTypesParam,
  SYSTEM_MAP_NODE_TYPES,
} from "@/lib/system-map/node-types";

describe("system map node types", () => {
  it("reads everything but the on-demand types by default", () => {
    for (const d of ON_DEMAND_NODE_TYPES) {
      expect(SYSTEM_MAP_NODE_TYPES).toContain(d.type);
      expect(DEFAULT_NODE_TYPES).not.toContain(d.type);
    }
    expect(DEFAULT_NODE_TYPES).toContain("SysComponent");
    expect(DEFAULT_NODE_TYPES).toContain("Actor");
    expect(DEFAULT_NODE_TYPES.length + ON_DEMAND_NODE_TYPES.length).toBe(SYSTEM_MAP_NODE_TYPES.length);
  });

  it("parses the types query parameter", () => {
    expect(parseNodeTypesParam(null)).toBeUndefined();
    expect(parseNodeTypesParam("")).toBeUndefined();
    expect(parseNodeTypesParam(" , ")).toBeUndefined();
    expect(parseNodeTypesParam("SysComponent, SysPackage,SysComponent")).toEqual(["SysComponent", "SysPackage"]);
    expect(parseNodeTypesParam("Sys Component")).toBeNull();
    expect(parseNodeTypesParam("Sys;drop")).toBeNull();
    expect(parseNodeTypesParam("1type")).toBeNull();
    expect(parseNodeTypesParam(Array.from({ length: 65 }, (_, i) => `T${i}`).join(","))).toBeNull();
  });
});
