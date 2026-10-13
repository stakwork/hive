import { describe, it, expect } from "vitest";
import {
  maskEnvValue,
  maskEnvVarList,
  maskEnvMap,
  unmaskEnvVarList,
  unmaskServiceEnvs,
} from "@/lib/env-mask";

describe("maskEnvValue", () => {
  it("masks short values entirely", () => {
    expect(maskEnvValue("")).toBe("****");
    expect(maskEnvValue("abcd")).toBe("****");
  });
  it("keeps first2 and last2 with at least 4 stars", () => {
    expect(maskEnvValue("abcde")).toBe("ab****de");
    expect(maskEnvValue("abcdefghij")).toBe("ab******ij");
  });
  it("masks lists and maps keeping names", () => {
    expect(maskEnvVarList([{ name: "A", value: "secretvalue" }])).toEqual([{ name: "A", value: "se*******ue" }]);
    expect(maskEnvMap({ K: "abcd" })).toEqual({ K: "****" });
    expect(maskEnvMap(undefined)).toEqual({});
  });
});

describe("unmask", () => {
  const stored = { API_KEY: "supersecret", OTHER: "xyz" };

  it("keeps the stored value when the mask is sent back", () => {
    const out = unmaskEnvVarList([{ name: "API_KEY", value: maskEnvValue("supersecret") }], stored);
    expect(out).toEqual([{ name: "API_KEY", value: "supersecret" }]);
  });
  it("replaces with the incoming value when changed", () => {
    expect(unmaskEnvVarList([{ name: "API_KEY", value: "newvalue" }], stored)[0].value).toBe("newvalue");
  });
  it("keeps unknown names as sent, even if they look masked", () => {
    expect(unmaskEnvVarList([{ name: "NEW", value: "ab****cd" }], stored)[0].value).toBe("ab****cd");
  });
  it("matches service env by service name + var name", () => {
    const services: Array<{ name: string; env?: Record<string, string> }> = [
      { name: "web", env: { TOKEN: maskEnvValue("webtoken1"), PLAIN: "x" } },
      { name: "api", env: { TOKEN: maskEnvValue("webtoken1") } },
      { name: "noenv" },
    ];
    const out = unmaskServiceEnvs(services, { web: { TOKEN: "webtoken1" } });
    expect(out[0].env).toEqual({ TOKEN: "webtoken1", PLAIN: "x" });
    expect(out[1].env).toEqual({ TOKEN: maskEnvValue("webtoken1") });
    expect(out[2]).toEqual({ name: "noenv" });
  });
  it("a service sent without env keeps its stored env; env: {} clears it", () => {
    const out = unmaskServiceEnvs(
      [{ name: "web" }, { name: "api", env: {} }] as Array<{ name: string; env?: Record<string, string> }>,
      { web: { TOKEN: "webtoken1" }, api: { TOKEN: "apitoken1" } },
    );
    expect(out[0].env).toEqual({ TOKEN: "webtoken1" });
    expect(out[1].env).toEqual({});
  });
});
