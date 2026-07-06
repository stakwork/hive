import { describe, it, expect } from "vitest";
import { scopeNodesToRepo } from "@/lib/utils/error-stack-frames";

const makeNode = (file: string, extra?: Record<string, unknown>) => ({
  ref_id: `ref-${file}`,
  node_type: "File" as const,
  properties: { file, namespace: "default", ...extra },
});

const makeFuncNode = (name: string, file: string) => ({
  ref_id: `ref-func-${name}`,
  node_type: "Function" as const,
  properties: { name, file, namespace: "default" },
});

describe("scopeNodesToRepo", () => {
  const targetRepo = "stakwork/senza-lnd";
  const nodes = [
    makeNode("stakwork/senza-lnd/app/controllers/admin/blacklists_controller.rb"),
    makeNode("stakwork/senza-lnd/app/workers/process_job.rb"),
    makeFuncNode("perform", "stakwork/senza-lnd/app/workers/process_job.rb"),
    makeNode("stakwork/stakwork-lambda/src/index.ts"),
    makeFuncNode("handler", "stakwork/stakwork-lambda/src/index.ts"),
  ];

  it("keeps nodes whose file path starts with the ownerRepo prefix", () => {
    const result = scopeNodesToRepo(nodes, targetRepo);
    expect(result).toHaveLength(3);
    expect(result.map((n) => n.ref_id)).toEqual([
      "ref-stakwork/senza-lnd/app/controllers/admin/blacklists_controller.rb",
      "ref-stakwork/senza-lnd/app/workers/process_job.rb",
      "ref-func-perform",
    ]);
  });

  it("drops nodes from a different repo (stakwork/stakwork-lambda)", () => {
    const result = scopeNodesToRepo(nodes, targetRepo);
    const refIds = result.map((n) => n.ref_id);
    expect(refIds).not.toContain("ref-stakwork/stakwork-lambda/src/index.ts");
    expect(refIds).not.toContain("ref-func-handler");
  });

  it("returns [] when ownerRepo is an empty string", () => {
    expect(scopeNodesToRepo(nodes, "")).toEqual([]);
  });

  it('returns [] when ownerRepo is "unknown"', () => {
    expect(scopeNodesToRepo(nodes, "unknown")).toEqual([]);
  });

  it("returns [] when ownerRepo is shorter than 3 characters", () => {
    expect(scopeNodesToRepo(nodes, "ab")).toEqual([]);
  });

  it("returns [] for an empty node list", () => {
    expect(scopeNodesToRepo([], targetRepo)).toEqual([]);
  });

  it("falls back to file_path when file property is absent", () => {
    const filePath = "stakwork/senza-lnd/lib/helper.rb";
    const nodeWithFilePath = {
      ref_id: "ref-fp",
      node_type: "File" as const,
      properties: { file_path: filePath, namespace: "default" },
    };
    const result = scopeNodesToRepo([nodeWithFilePath], targetRepo);
    expect(result).toHaveLength(1);
    expect(result[0].ref_id).toBe("ref-fp");
  });

  it("excludes nodes with no file or file_path property", () => {
    const noPath = {
      ref_id: "ref-nopath",
      node_type: "File" as const,
      properties: { namespace: "default" },
    };
    expect(scopeNodesToRepo([noPath], targetRepo)).toEqual([]);
  });

  it("does not match a node whose file path merely contains ownerRepo as a substring (not prefix)", () => {
    const node = makeNode("other-org/stakwork/senza-lnd/some/file.rb");
    expect(scopeNodesToRepo([node], targetRepo)).toEqual([]);
  });
});
