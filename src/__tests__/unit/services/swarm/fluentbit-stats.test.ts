import { describe, test, expect, beforeEach, vi } from "vitest";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/fluentbit-stats.contract.json";
import {
  GET_FLUENTBIT_STATS_CMD,
  parseFluentbitStats,
  computeFluentbitRates,
  NULL_FLUENTBIT_RATES,
  type FluentbitPrevSample,
} from "@/services/swarm/fluentbit-stats";

type Body = Record<string, unknown>;

function clone(obj: unknown): Body {
  return JSON.parse(JSON.stringify(obj)) as Body;
}

function okResponse(data: unknown): SwarmCmdResponse {
  return { ok: true, status: 200, data, rawText: undefined };
}

function sample(overrides: Partial<FluentbitPrevSample> = {}): FluentbitPrevSample {
  return {
    collectedAt: 1_000,
    inputBytes: 1000,
    inputRecords: 100,
    outputProcBytes: 800,
    outputProcRecords: 80,
    ...overrides,
  };
}

describe("GET_FLUENTBIT_STATS_CMD", () => {
  test("is the server-side constant, never assembled from request input", () => {
    expect(GET_FLUENTBIT_STATS_CMD).toEqual({
      type: "Swarm",
      data: { cmd: "GetFluentbitStats" },
    });
    expect(Object.keys(GET_FLUENTBIT_STATS_CMD.data)).toEqual(["cmd"]);
  });
});

describe("parseFluentbitStats — status classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("OK: clean well-formed body, available true, no errors", () => {
    const reading = parseFluentbitStats(okResponse(clone(contractFixture)));

    expect(reading.status).toBe("OK");
    expect(reading.reason).toBeUndefined();
    expect(reading.available).toBe(true);
    expect(reading.collectedAt).toBe(1757430000);
    expect(reading.inputBytes).toBe(12345);
    expect(reading.inputRecords).toBe(67);
    expect(reading.outputProcBytes).toBe(12000);
    expect(reading.outputProcRecords).toBe(65);
    expect(reading.filterDropRecords).toBe(0);
    expect(reading.outputDroppedRecords).toBe(0);
    expect(reading.outputErrors).toBe(0);
    expect(reading.retriesFailed).toBe(0);
    expect(reading.uptimeSeconds).toBe(3600);
    expect(reading.errors).toEqual([]);
    expect(reading.rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(reading.rateWindowSeconds).toBeNull();
  });

  test("PARTIAL: well-formed body, available true, non-empty errors[]", () => {
    const body = clone(contractFixture);
    body.errors = ["collector timed out"];

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("PARTIAL");
    expect(reading.reason).toBeUndefined();
    expect(reading.available).toBe(true);
    expect(reading.inputBytes).toBe(12345);
    expect(reading.errors).toEqual(["collector timed out"]);
  });

  test("UNAVAILABLE: well-formed body with available false is not PARTIAL and not a failure", () => {
    const body = clone(contractFixture);
    body.available = false;
    body.errors = ["fluentbit not running"];

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("UNAVAILABLE");
    expect(reading.reason).toBeUndefined();
    expect(reading.available).toBe(false);
    expect(reading.collectedAt).toBe(1757430000);
    expect(reading.errors).toEqual(["fluentbit not running"]);
  });

  test("ERROR: stack_error body", () => {
    const reading = parseFluentbitStats(okResponse({ stack_error: "fluentbit exploded" }));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("STACK_ERROR");
    expect(reading.inputBytes).toBeNull();
    expect(reading.collectedAt).toBeNull();
  });

  test("ERROR: body that fails validation is MALFORMED, with no raw body echoed through", () => {
    const reading = parseFluentbitStats(
      okResponse({ available: "yes", leaked: "SECRET_MARKER_RAW_BODY" }),
    );

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("MALFORMED");
    expect(JSON.stringify(reading)).not.toContain("SECRET_MARKER_RAW_BODY");
    expect("rawText" in reading).toBe(false);
  });

  test("UNREACHABLE: non-2xx response", () => {
    const reading = parseFluentbitStats({
      ok: false,
      status: 502,
      data: undefined,
      rawText: "Bad Gateway",
    });

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.reason).toBe("UNREACHABLE");
    expect(reading.inputBytes).toBeNull();
  });

  test("UNREACHABLE: empty/undefined body", () => {
    expect(parseFluentbitStats(okResponse(undefined)).status).toBe("UNREACHABLE");
    expect(parseFluentbitStats(okResponse(null)).status).toBe("UNREACHABLE");
  });

  test("UNREACHABLE: timeout result from swarmCmdRequest", () => {
    const reading = parseFluentbitStats({
      ok: false,
      status: 0,
      data: null,
      rawText: "",
      errorCode: "TIMEOUT",
    });

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.reason).toBe("UNREACHABLE");
  });

  test("non-2xx bodies are UNREACHABLE even when they parse as JSON", () => {
    const reading = parseFluentbitStats({
      ok: false,
      status: 500,
      data: clone(contractFixture),
    });

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.inputBytes).toBeNull();
  });
});

describe("parseFluentbitStats — never fabricate a number", () => {
  test("null counters stay null, never 0; a genuine 0 stays 0", () => {
    const body = clone(contractFixture);
    body.input_bytes = null;
    body.input_records = 0;
    body.output_proc_bytes = null;
    body.output_proc_records = 0;
    body.filter_drop_records = null;
    body.output_dropped_records = 0;
    body.output_errors = null;
    body.retries_failed = 0;
    body.uptime_seconds = null;

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("OK");
    expect(reading.inputBytes).toBeNull();
    expect(reading.inputRecords).toBe(0);
    expect(reading.outputProcBytes).toBeNull();
    expect(reading.outputProcRecords).toBe(0);
    expect(reading.filterDropRecords).toBeNull();
    expect(reading.outputDroppedRecords).toBe(0);
    expect(reading.outputErrors).toBeNull();
    expect(reading.retriesFailed).toBe(0);
    expect(reading.uptimeSeconds).toBeNull();
    expect(JSON.stringify(reading)).not.toMatch(/"inputBytes":0/);
  });

  test("unknown keys are stripped and never returned", () => {
    const body = clone(contractFixture);
    body.leaked = "SECRET_MARKER_UNKNOWN_KEY";
    body.extra_counter = 99;

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("OK");
    expect(JSON.stringify(reading)).not.toContain("SECRET_MARKER_UNKNOWN_KEY");
    expect(JSON.stringify(reading)).not.toContain("extra_counter");
  });
});

describe("parseFluentbitStats — Zod hardening", () => {
  test("errors[] is capped at 64 entries", () => {
    const body = clone(contractFixture);
    body.errors = Array.from({ length: 70 }, (_, i) => `e${i}`);

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("PARTIAL");
    expect(reading.errors).toHaveLength(64);
    expect(reading.errors[0]).toBe("e0");
    expect(reading.errors[63]).toBe("e63");
  });

  test("error strings are truncated to 256 characters", () => {
    const body = clone(contractFixture);
    body.errors = ["x".repeat(1000)];

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.errors[0]).toHaveLength(256);
  });

  test("a hostile i64 / non-integer counter fails validation as MALFORMED", () => {
    const body = clone(contractFixture);
    body.input_bytes = Number.MAX_SAFE_INTEGER + 1;

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("MALFORMED");
  });

  test("a negative counter fails validation as MALFORMED", () => {
    const body = clone(contractFixture);
    body.input_records = -1;

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("MALFORMED");
  });

  test("a body missing required fields fails validation as MALFORMED", () => {
    const body = clone(contractFixture);
    delete body.collected_at;
    body.leaked = "SECRET_MARKER_MISSING_FIELD";

    const reading = parseFluentbitStats(okResponse(body));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("MALFORMED");
    expect(JSON.stringify(reading)).not.toContain("SECRET_MARKER_MISSING_FIELD");
  });
});

describe("parseFluentbitStats — pinned contract fixture", () => {
  test("fluentbit-stats.contract.json parses as OK with snake_case fields mapped", () => {
    const reading = parseFluentbitStats(okResponse(clone(contractFixture)));

    expect(reading.status).toBe("OK");
    expect(reading.collectedAt).toBe(contractFixture.collected_at);
    expect(reading.inputBytes).toBe(contractFixture.input_bytes);
    expect(reading.inputRecords).toBe(contractFixture.input_records);
    expect(reading.outputProcBytes).toBe(contractFixture.output_proc_bytes);
    expect(reading.outputProcRecords).toBe(contractFixture.output_proc_records);
    expect(reading.filterDropRecords).toBe(contractFixture.filter_drop_records);
    expect(reading.outputDroppedRecords).toBe(contractFixture.output_dropped_records);
    expect(reading.outputErrors).toBe(contractFixture.output_errors);
    expect(reading.retriesFailed).toBe(contractFixture.retries_failed);
    expect(reading.uptimeSeconds).toBe(contractFixture.uptime_seconds);
  });
});

describe("computeFluentbitRates", () => {
  test("first sample (prev null) → all rates null, never 0", () => {
    const { rates, rateWindowSeconds } = computeFluentbitRates(null, sample());

    expect(rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(rateWindowSeconds).toBeNull();
    expect(Object.values(rates).every((r) => r === null)).toBe(true);
  });

  test("happy-path delta → correct bytes/sec and records/sec", () => {
    const prev = sample({ collectedAt: 1000 });
    const curr = sample({
      collectedAt: 1010,
      inputBytes: 3000,
      inputRecords: 200,
      outputProcBytes: 1800,
      outputProcRecords: 130,
    });

    const { rates, rateWindowSeconds } = computeFluentbitRates(prev, curr);

    expect(rateWindowSeconds).toBe(10);
    expect(rates.inputBytesPerSec).toBe(200);
    expect(rates.inputRecordsPerSec).toBe(10);
    expect(rates.outputProcBytesPerSec).toBe(100);
    expect(rates.outputProcRecordsPerSec).toBe(5);
  });

  test("counter went backwards (restart) → that rate null, others unaffected", () => {
    const prev = sample({ collectedAt: 1000, inputBytes: 5000, inputRecords: 100 });
    const curr = sample({
      collectedAt: 1060,
      inputBytes: 10,
      inputRecords: 160,
      outputProcBytes: 1400,
      outputProcRecords: 140,
    });

    const { rates, rateWindowSeconds } = computeFluentbitRates(prev, curr);

    expect(rates.inputBytesPerSec).toBeNull();
    expect(rates.inputRecordsPerSec).toBe(1);
    expect(rates.outputProcBytesPerSec).toBe(10);
    expect(rates.outputProcRecordsPerSec).toBe(1);
    expect(rateWindowSeconds).toBe(60);
  });

  test("one side null → that rate null", () => {
    const prev = sample({ collectedAt: 1000, inputBytes: null, outputProcBytes: 800 });
    const curr = sample({
      collectedAt: 1060,
      inputBytes: 2000,
      inputRecords: null,
      outputProcBytes: 1400,
    });

    const { rates, rateWindowSeconds } = computeFluentbitRates(prev, curr);

    expect(rates.inputBytesPerSec).toBeNull();
    expect(rates.inputRecordsPerSec).toBeNull();
    expect(rates.outputProcBytesPerSec).toBe(10);
    expect(rates.outputProcRecordsPerSec).toBe(0);
    expect(rateWindowSeconds).toBe(60);
  });

  test("deltaSeconds < 1 → all rates null", () => {
    const { rates, rateWindowSeconds } = computeFluentbitRates(
      sample({ collectedAt: 1000 }),
      sample({ collectedAt: 1000 }),
    );

    expect(rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(rateWindowSeconds).toBeNull();
  });

  test("deltaSeconds > 600 → all rates null", () => {
    const { rates, rateWindowSeconds } = computeFluentbitRates(
      sample({ collectedAt: 1000 }),
      sample({ collectedAt: 1601 }),
    );

    expect(rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(rateWindowSeconds).toBeNull();
  });

  test("deltaSeconds === 600 is still eligible", () => {
    const { rates, rateWindowSeconds } = computeFluentbitRates(
      sample({ collectedAt: 1000, inputBytes: 0 }),
      sample({ collectedAt: 1600, inputBytes: 600 }),
    );

    expect(rateWindowSeconds).toBe(600);
    expect(rates.inputBytesPerSec).toBe(1);
  });

  test("deltaSeconds === 1 is eligible", () => {
    const { rates, rateWindowSeconds } = computeFluentbitRates(
      sample({ collectedAt: 1000, inputBytes: 0 }),
      sample({ collectedAt: 1001, inputBytes: 50 }),
    );

    expect(rateWindowSeconds).toBe(1);
    expect(rates.inputBytesPerSec).toBe(50);
  });

  test("non-finite / overflow inputs → null, never 0, never Infinity/NaN", () => {
    const corruptPrev = {
      collectedAt: Number.POSITIVE_INFINITY,
      inputBytes: 1000,
      inputRecords: 100,
      outputProcBytes: 800,
      outputProcRecords: 80,
    };
    const { rates: r1, rateWindowSeconds: w1 } = computeFluentbitRates(
      corruptPrev as FluentbitPrevSample,
      sample(),
    );
    expect(r1).toEqual(NULL_FLUENTBIT_RATES);
    expect(w1).toBeNull();

    const nanCurr = sample({ collectedAt: Number.NaN });
    const { rates: r2 } = computeFluentbitRates(sample(), nanCurr);
    expect(r2).toEqual(NULL_FLUENTBIT_RATES);

    const huge = sample({
      collectedAt: 1001,
      inputBytes: Number.MAX_SAFE_INTEGER,
    });
    const tinyPrev = sample({ collectedAt: 1000, inputBytes: 0 });
    const { rates: r3 } = computeFluentbitRates(tinyPrev, huge);
    expect(r3.inputBytesPerSec).toBeNull();
    expect(Number.isFinite(r3.inputBytesPerSec ?? 0) || r3.inputBytesPerSec === null).toBe(true);
    expect(r3.inputBytesPerSec).not.toBe(0);
  });

  test("corrupt prev shape is treated as first sample", () => {
    const { rates, rateWindowSeconds } = computeFluentbitRates(
      { collectedAt: 1000 } as FluentbitPrevSample,
      sample(),
    );

    expect(rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(rateWindowSeconds).toBeNull();
  });

  test("rateWindowSeconds is null when no rate could be computed at all", () => {
    const prev = sample({
      collectedAt: 1000,
      inputBytes: null,
      inputRecords: null,
      outputProcBytes: null,
      outputProcRecords: null,
    });
    const curr = sample({
      collectedAt: 1060,
      inputBytes: null,
      inputRecords: null,
      outputProcBytes: null,
      outputProcRecords: null,
    });

    const { rates, rateWindowSeconds } = computeFluentbitRates(prev, curr);

    expect(rates).toEqual(NULL_FLUENTBIT_RATES);
    expect(rateWindowSeconds).toBeNull();
  });
});
