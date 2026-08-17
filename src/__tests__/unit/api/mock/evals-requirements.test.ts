import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GET, POST } from "@/app/api/mock/evals/[evalSetId]/requirements/route";
import {
  PUT as putRequirement,
  DELETE as deleteRequirement,
} from "@/app/api/mock/evals/[evalSetId]/requirements/[reqId]/route";
import { NextRequest } from "next/server";

const originalUseMocks = process.env.USE_MOCKS;

beforeEach(() => {
  process.env.USE_MOCKS = "true";
});

afterEach(() => {
  if (originalUseMocks === undefined) {
    delete process.env.USE_MOCKS;
  } else {
    process.env.USE_MOCKS = originalUseMocks;
  }
});

function makeGetRequest(evalSetId: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements`,
    { method: "GET" },
  );
}

function makePostRequest(evalSetId: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makePutRequest(evalSetId: string, reqId: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements/${reqId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("GET /api/mock/evals/[evalSetId]/requirements", () => {
  test("returns seeded requirements for eval-set-1", async () => {
    const request = makeGetRequest("eval-set-1");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    expect(data.data.total).toBe(data.data.nodes.length);

    // All nodes belong to EvalRequirement type
    for (const node of data.data.nodes) {
      expect(node.node_type).toBe("EvalRequirement");
      expect(node.ref_id).toBeDefined();
      expect(node.properties.name).toBeDefined();
      expect(node.properties.prompt_snippet).toBeDefined();
      expect(Array.isArray(node.properties.desirable_cases)).toBe(true);
      expect(Array.isArray(node.properties.undesirable_cases)).toBe(true);
      expect(typeof node.properties.order).toBe("number");
    }
  });

  test("returns seeded requirements for eval-set-2", async () => {
    const request = makeGetRequest("eval-set-2");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-2" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
  });

  test("eval-set-1 and eval-set-2 return different requirements", async () => {
    const res1 = await GET(makeGetRequest("eval-set-1"), { params: Promise.resolve({ evalSetId: "eval-set-1" }) });
    const res2 = await GET(makeGetRequest("eval-set-2"), { params: Promise.resolve({ evalSetId: "eval-set-2" }) });

    const data1 = await res1.json();
    const data2 = await res2.json();

    const ids1 = data1.data.nodes.map((n: { ref_id: string }) => n.ref_id);
    const ids2 = data2.data.nodes.map((n: { ref_id: string }) => n.ref_id);

    // No overlap between the two sets
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  test("returns empty array for unknown eval set id", async () => {
    const request = makeGetRequest("unknown-eval-set-xyz");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "unknown-eval-set-xyz" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes).toEqual([]);
    expect(data.data.total).toBe(0);
  });

  test("returns 200 status", async () => {
    const request = makeGetRequest("eval-set-1");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1" }) });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/mock/evals/[evalSetId]/requirements", () => {
  test("creates a new requirement node and returns its ref_id", async () => {
    const body = {
      name: "Test Req",
      description: "A description",
      prompt_snippet: "When asked to do X",
      desirable_cases: ["Does X correctly"],
      undesirable_cases: ["Fails silently"],
    };
    const request = makePostRequest("eval-set-1", body);
    const response = await POST(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(typeof data.data.ref_id).toBe("string");
    expect(data.data.ref_id.length).toBeGreaterThan(0);
  });

  test("echoes the created properties including contested", async () => {
    const request = makePostRequest("eval-set-1", {
      name: "Contested at birth",
      description: "A description",
      contested: true,
    });
    const response = await POST(request);
    const data = await response.json();

    expect(data.data.name).toBe("Contested at birth");
    expect(data.data.contested).toBe(true);
  });

  test("defaults contested to false when omitted", async () => {
    const request = makePostRequest("eval-set-1", { name: "Plain req" });
    const response = await POST(request);
    const data = await response.json();

    expect(data.data.contested).toBe(false);
  });
});

describe("Seeded contested requirement", () => {
  test("exactly one seeded requirement is marked contested", async () => {
    const response = await GET(makeGetRequest("eval-set-1"), {
      params: Promise.resolve({ evalSetId: "eval-set-1" }),
    });
    const data = await response.json();

    const contestedNodes = data.data.nodes.filter(
      (n: { properties: { contested?: boolean } }) => n.properties.contested === true,
    );
    expect(contestedNodes).toHaveLength(1);
  });

  test("uncontested seeded requirements omit the flag entirely", async () => {
    const response = await GET(makeGetRequest("eval-set-2"), {
      params: Promise.resolve({ evalSetId: "eval-set-2" }),
    });
    const data = await response.json();

    for (const node of data.data.nodes) {
      expect(node.properties.contested).toBeUndefined();
    }
  });
});

describe("PUT /api/mock/evals/[evalSetId]/requirements/[reqId]", () => {
  // The mock PUT reflects the whole body, so `contested` round-trips with no
  // field list to keep in sync — this is the regression guard on that.
  test("echoes contested back on both toggle directions", async () => {
    for (const contested of [true, false]) {
      const response = await putRequirement(
        makePutRequest("eval-set-1", "req-1-1", { name: "Req", contested }),
        { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) },
      );
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.ref_id).toBe("req-1-1");
      expect(data.data.contested).toBe(contested);
    }
  });
});

// ── USE_MOCKS guard ───────────────────────────────────────────────────────────
//
// middleware.ts only blocks /api/mock when NODE_ENV === "production", so without
// an in-handler guard these are live, arbitrary-JSON-reflecting endpoints on
// every preview/staging build.
describe("USE_MOCKS guard", () => {
  test.each([undefined, "false", "1", "TRUE"])(
    "GET 404s when USE_MOCKS is %o",
    async (value) => {
      if (value === undefined) delete process.env.USE_MOCKS;
      else process.env.USE_MOCKS = value;

      const response = await GET(makeGetRequest("eval-set-1"), {
        params: Promise.resolve({ evalSetId: "eval-set-1" }),
      });
      expect(response.status).toBe(404);
    },
  );

  test("POST 404s when USE_MOCKS is not \"true\"", async () => {
    delete process.env.USE_MOCKS;

    const response = await POST(makePostRequest("eval-set-1", { name: "Req" }));
    expect(response.status).toBe(404);
  });

  test("PUT 404s when USE_MOCKS is not \"true\"", async () => {
    delete process.env.USE_MOCKS;

    const response = await putRequirement(
      makePutRequest("eval-set-1", "req-1-1", { name: "Req", contested: true }),
      { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) },
    );
    expect(response.status).toBe(404);
  });

  test("DELETE 404s when USE_MOCKS is not \"true\"", async () => {
    delete process.env.USE_MOCKS;

    const response = await deleteRequirement(
      makePutRequest("eval-set-1", "req-1-1", {}),
      { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) },
    );
    expect(response.status).toBe(404);
  });

  test("the guard does not depend on NODE_ENV", async () => {
    // Explicitly non-production: the middleware block would not fire here, so
    // the in-handler guard is the only thing standing.
    expect(process.env.NODE_ENV).not.toBe("production");
    delete process.env.USE_MOCKS;

    const response = await putRequirement(
      makePutRequest("eval-set-1", "req-1-1", { injected: "payload" }),
      { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) },
    );
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.injected).toBeUndefined();
  });
});
