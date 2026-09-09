/**
 * Unit tests for POST /api/mock/jarvis/graph/search/attributes.
 *
 * The Recursion tab under USE_MOCKS depends on this route branching on the
 * recursion filter *value*, not just the attribute name.
 */
import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/mock/jarvis/graph/search/attributes/route";
import {
  ATTEMPT_CAP_EVALSET_ID,
  CONCEPT_ONLY_EVALSET_ID,
  EVAL_SET_ID,
  PLATEAU_CAP_EVALSET_ID,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

const URL = "http://localhost:3000/api/mock/jarvis/graph/search/attributes";

async function postSearch(body: Record<string, unknown>) {
  const req = new NextRequest(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, data: await res.json() };
}

describe("POST /api/mock/jarvis/graph/search/attributes", () => {
  test("value === true returns live-on EvalSets (all recursion: true)", async () => {
    const { status, data } = await postSearch({
      node_type: ["EvalSet", "Evalset"],
      search_filters: [{ attribute: "recursion", value: true, comparator: "=" }],
    });

    expect(status).toBe(200);
    expect(data.status).toBe("success");
    const nodes = data.nodes as Array<{ ref_id: string; properties: { recursion?: boolean } }>;
    expect(nodes.length).toBeGreaterThan(0);
    const ids = nodes.map((n) => n.ref_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        EVAL_SET_ID,
        CONCEPT_ONLY_EVALSET_ID,
        ATTEMPT_CAP_EVALSET_ID,
        PLATEAU_CAP_EVALSET_ID,
      ]),
    );
    expect(nodes.every((n) => n.properties.recursion === true)).toBe(true);
  });

  test("value === false returns a distinct disabled fixture, not the true list", async () => {
    const trueResult = await postSearch({
      node_type: ["EvalSet"],
      search_filters: [{ attribute: "recursion", value: true, comparator: "=" }],
    });
    const falseResult = await postSearch({
      node_type: ["EvalSet"],
      search_filters: [{ attribute: "recursion", value: false, comparator: "=" }],
    });

    const trueIds = (trueResult.data.nodes as Array<{ ref_id: string }>).map((n) => n.ref_id);
    const falseNodes = falseResult.data.nodes as Array<{
      ref_id: string;
      properties: { recursion?: boolean; recursionEnabledAt?: number };
    }>;
    const falseIds = falseNodes.map((n) => n.ref_id);

    expect(falseNodes.length).toBeGreaterThan(0);
    expect(falseIds.some((id) => trueIds.includes(id))).toBe(false);
    expect(falseNodes.every((n) => n.properties.recursion === false)).toBe(true);
    expect(falseNodes.some((n) => n.properties.recursionEnabledAt != null)).toBe(true);
  });

  test("attribute name alone is not enough — missing value does not echo the true list", async () => {
    const { data } = await postSearch({
      node_type: ["EvalSet"],
      search_filters: [{ attribute: "recursion" }],
    });

    expect(data.nodes).toEqual([]);
  });
});
