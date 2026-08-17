import { describe, test, expect, vi } from "vitest";

// The module also exports the gateway rate-limit helper, which pulls in the
// Redis client at import time — stub it so these pure-helper tests don't dial out.
vi.mock("@/lib/redis", () => ({
  redis: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn() },
}));

import {
  canWriteContested,
  coerce,
  findRequirement,
  hasContestedKey,
  isValidEvalRefId,
} from "@/lib/evals/requirement-writes";

describe("coerce", () => {
  describe("truthy inputs", () => {
    test.each([true, 1, "true", "TRUE", "True", " true "])(
      "%o coerces to boolean true",
      (input) => {
        const result = coerce(input, "contested");
        expect(result).toEqual({ ok: true, value: true });
      },
    );
  });

  describe("falsy inputs", () => {
    test.each([false, 0, "false", "FALSE", "False", " false "])(
      "%o coerces to boolean false",
      (input) => {
        const result = coerce(input, "contested");
        expect(result).toEqual({ ok: true, value: false });
      },
    );
  });

  describe("un-coercible inputs", () => {
    test.each(["maybe", "", "yes", "no", "1", "0", 2, -1, null, undefined, {}, []])(
      "%o is rejected rather than silently falling back to false",
      (input) => {
        const result = coerce(input, "contested");
        expect(result.ok).toBe(false);
      },
    );

    test("error message names the offending field", () => {
      const result = coerce("maybe", "contested");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("contested");
      }
    });

    test("returns a real JSON boolean, not a truthy value", () => {
      const result = coerce("true", "contested");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.value).toBe("boolean");
      }
    });
  });
});

describe("hasContestedKey", () => {
  test("true when the key is present, even when explicitly false", () => {
    expect(hasContestedKey({ contested: false })).toBe(true);
  });

  test("true when the key is present but undefined — the caller still named it", () => {
    expect(hasContestedKey({ contested: undefined })).toBe(true);
  });

  test("false when the key is absent", () => {
    expect(hasContestedKey({ name: "req" })).toBe(false);
  });

  test("false for non-objects", () => {
    expect(hasContestedKey(null)).toBe(false);
    expect(hasContestedKey("contested")).toBe(false);
  });
});

describe("isValidEvalRefId", () => {
  test("accepts opaque Jarvis ref_ids", () => {
    expect(isValidEvalRefId("evalset-gw-ref-001")).toBe(true);
    expect(isValidEvalRefId("abc_123")).toBe(true);
  });

  test("rejects ids that could steer the Jarvis URL", () => {
    expect(isValidEvalRefId("../../v2/nodes")).toBe(false);
    expect(isValidEvalRefId("set?expand=edges")).toBe(false);
    expect(isValidEvalRefId("set/child")).toBe(false);
    expect(isValidEvalRefId("")).toBe(false);
    expect(isValidEvalRefId(123)).toBe(false);
  });
});

describe("findRequirement", () => {
  const requirements = [
    { ref_id: "req-1", node_type: "EvalRequirement", properties: { contested: true } },
    { ref_id: "req-2", node_type: "EvalRequirement", properties: {} },
  ];

  test("returns the matching requirement", () => {
    expect(findRequirement(requirements, "req-1")?.properties?.contested).toBe(true);
  });

  test("returns null for a requirement from another eval set", () => {
    expect(findRequirement(requirements, "req-999")).toBeNull();
  });

  test("returns null for a malformed ref_id", () => {
    expect(findRequirement(requirements, "../req-1")).toBeNull();
  });
});

describe("canWriteContested", () => {
  test.each(["OWNER", "ADMIN", "PM", "DEVELOPER"])("%s may write contested", (role) => {
    expect(canWriteContested(role)).toBe(true);
  });

  test.each(["VIEWER", "STAKEHOLDER", "", "owner"])(
    "%s may not write contested",
    (role) => {
      expect(canWriteContested(role)).toBe(false);
    },
  );
});
