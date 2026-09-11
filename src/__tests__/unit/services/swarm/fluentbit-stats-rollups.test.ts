import { describe, expect, it } from "vitest";
import {
  computeContainersToday,
  computeIngestBuckets,
  parseStoredFluentbitContainers,
  type FluentbitContainerSample,
  type FluentbitRollupSample,
} from "@/services/swarm/fluentbit-stats-rollups";

const NOW = new Date("2026-09-11T15:00:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

function sample(
  iso: string,
  bytes: bigint | number | null,
  records: bigint | number | null = bytes,
): FluentbitRollupSample {
  return {
    collectedAt: at(iso),
    inputBytes: typeof bytes === "number" ? BigInt(bytes) : bytes,
    inputRecords: typeof records === "number" ? BigInt(records) : records,
  };
}

function containerSample(
  iso: string,
  containers: unknown,
): FluentbitContainerSample {
  return { collectedAt: at(iso), containers };
}

describe("computeIngestBuckets", () => {
  it("sums positive consecutive deltas into today, yesterday, and last 7 days", () => {
    const samples = [
      sample("2026-09-05T12:00:00.000Z", 200),
      sample("2026-09-06T12:00:00.000Z", 350),
      sample("2026-09-08T12:00:00.000Z", 500),
      sample("2026-09-09T12:00:00.000Z", 700),
      sample("2026-09-10T12:00:00.000Z", 900),
      sample("2026-09-11T01:00:00.000Z", 1000),
      sample("2026-09-11T12:00:00.000Z", 1300),
    ];

    const ingest = computeIngestBuckets(samples, NOW);

    expect(ingest.today).toEqual({ inputBytes: 400, inputRecords: 400 });
    expect(ingest.yesterday).toEqual({ inputBytes: 200, inputRecords: 200 });
    expect(ingest.last7Days).toEqual({ inputBytes: 1100, inputRecords: 1100 });
  });

  it("returns null (never 0) for a UTC day with no samples", () => {
    const samples = [
      sample("2026-09-09T12:00:00.000Z", 100),
      sample("2026-09-09T18:00:00.000Z", 150),
      sample("2026-09-11T12:00:00.000Z", 200),
    ];

    const ingest = computeIngestBuckets(samples, NOW);

    expect(ingest.yesterday.inputBytes).toBeNull();
    expect(ingest.yesterday.inputRecords).toBeNull();
    expect(ingest.yesterday.inputBytes).not.toBe(0);
  });

  it("returns null for a day with only one sample and no baseline", () => {
    const ingest = computeIngestBuckets(
      [sample("2026-09-11T12:00:00.000Z", 5000)],
      NOW,
    );

    expect(ingest.today).toEqual({ inputBytes: null, inputRecords: null });
    expect(ingest.yesterday).toEqual({ inputBytes: null, inputRecords: null });
    expect(ingest.last7Days).toEqual({ inputBytes: null, inputRecords: null });
  });

  it("skips a counter-reset pair without zeroing the rest of the day", () => {
    const samples = [
      sample("2026-09-11T01:00:00.000Z", 1000),
      sample("2026-09-11T06:00:00.000Z", 100),
      sample("2026-09-11T12:00:00.000Z", 400),
    ];

    const ingest = computeIngestBuckets(samples, NOW);

    expect(ingest.today.inputBytes).toBe(300);
    expect(ingest.today.inputRecords).toBe(300);
  });

  it("sums last7Days across non-null days when one day is a gap", () => {
    const samples = [
      sample("2026-09-05T12:00:00.000Z", 100),
      sample("2026-09-06T12:00:00.000Z", 250),
      sample("2026-09-08T12:00:00.000Z", 400),
      sample("2026-09-09T12:00:00.000Z", 600),
      sample("2026-09-10T12:00:00.000Z", 800),
      sample("2026-09-11T12:00:00.000Z", 950),
    ];

    const ingest = computeIngestBuckets(samples, NOW);

    expect(ingest.yesterday.inputBytes).toBe(200);
    expect(ingest.today.inputBytes).toBe(150);
    expect(ingest.last7Days.inputBytes).toBe(850);
  });

  it("returns null last7Days only when every day in the window is null", () => {
    const empty = computeIngestBuckets([], NOW);
    expect(empty.last7Days).toEqual({ inputBytes: null, inputRecords: null });

    const outside = computeIngestBuckets(
      [
        sample("2026-08-01T12:00:00.000Z", 10),
        sample("2026-08-01T18:00:00.000Z", 40),
      ],
      NOW,
    );
    expect(outside.last7Days).toEqual({ inputBytes: null, inputRecords: null });
  });

  it("attributes a midnight-spanning pair entirely to the later UTC day", () => {
    const samples = [
      sample("2026-09-10T23:00:00.000Z", 500),
      sample("2026-09-11T01:00:00.000Z", 800),
    ];

    const ingest = computeIngestBuckets(samples, NOW);

    expect(ingest.today.inputBytes).toBe(300);
    expect(ingest.yesterday.inputBytes).toBeNull();
    expect(ingest.last7Days.inputBytes).toBe(300);
  });

  it("computes bytes and records independently when one side is null", () => {
    const samples = [
      sample("2026-09-11T01:00:00.000Z", 100, 10),
      sample("2026-09-11T06:00:00.000Z", null, 40),
      sample("2026-09-11T12:00:00.000Z", 250, 55),
    ];

    const ingest = computeIngestBuckets(samples, NOW);

    // Consecutive pairs only: the null bytes at 06:00 skip both byte pairs.
    expect(ingest.today.inputBytes).toBeNull();
    expect(ingest.today.inputRecords).toBe(45);
  });
});

describe("parseStoredFluentbitContainers", () => {
  it("accepts camelCase stored rows and snake_case wire rows", () => {
    expect(
      parseStoredFluentbitContainers([
        { containerName: "hive-web", inputBytes: 8, inputRecords: 2 },
      ]),
    ).toEqual([{ containerName: "hive-web", inputBytes: 8, inputRecords: 2 }]);

    expect(
      parseStoredFluentbitContainers([
        { container_name: "hive-web", input_bytes: 8, input_records: 2 },
      ]),
    ).toEqual([{ containerName: "hive-web", inputBytes: 8, inputRecords: 2 }]);
  });

  it("returns null for corrupt or empty blobs without throwing", () => {
    expect(parseStoredFluentbitContainers(null)).toBeNull();
    expect(parseStoredFluentbitContainers("nope")).toBeNull();
    expect(parseStoredFluentbitContainers({ containerName: "x" })).toBeNull();
    expect(parseStoredFluentbitContainers([])).toBeNull();
    expect(parseStoredFluentbitContainers([{ extra: true }])).toBeNull();
  });

  it("caps the array at 64 entries and names at 256 chars", () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({
      containerName: "c" + String(i),
      inputBytes: i,
      inputRecords: i,
    }));
    const parsed = parseStoredFluentbitContainers(rows);
    expect(parsed).toHaveLength(64);

    const longName = "n".repeat(300);
    const capped = parseStoredFluentbitContainers([
      { containerName: longName, inputBytes: 1, inputRecords: 1 },
    ]);
    expect(capped?.[0].containerName).toHaveLength(256);
  });
});

describe("computeContainersToday", () => {
  it("uses a pre-today baseline against live to compute a positive delta", () => {
    const rows = computeContainersToday(
      [{ containerName: "hive-web", inputBytes: 5000, inputRecords: 50 }],
      [],
      [
        containerSample("2026-09-10T22:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 2000, inputRecords: 20 },
        ]),
      ],
      NOW,
    );

    expect(rows).toEqual([
      { containerName: "hive-web", inputBytes: 3000, inputRecords: 30 },
    ]);
  });

  it("includes a new container with no baseline using the latest lifetime value", () => {
    const rows = computeContainersToday(
      [
        { containerName: "hive-web", inputBytes: 5000, inputRecords: 50 },
        { containerName: "neo4j", inputBytes: 100, inputRecords: 5 },
      ],
      [],
      [
        containerSample("2026-09-10T22:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 4000, inputRecords: 40 },
        ]),
      ],
      NOW,
    );

    expect(rows).toEqual([
      { containerName: "hive-web", inputBytes: 1000, inputRecords: 10 },
      { containerName: "neo4j", inputBytes: 100, inputRecords: 5 },
    ]);
  });

  it("omits a container whose delta is negative (restart)", () => {
    const rows = computeContainersToday(
      [{ containerName: "hive-web", inputBytes: 100, inputRecords: 2 }],
      [],
      [
        containerSample("2026-09-10T22:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 5000, inputRecords: 50 },
        ]),
      ],
      NOW,
    );

    expect(rows).toEqual([]);
  });

  it("ignores corrupt stored containers JSON without throwing", () => {
    expect(() =>
      computeContainersToday(
        null,
        [
          containerSample("2026-09-11T01:00:00.000Z", "not-json-array"),
          containerSample("2026-09-11T12:00:00.000Z", [
            { containerName: "hive-web", inputBytes: 900, inputRecords: 9 },
          ]),
        ],
        [containerSample("2026-09-10T22:00:00.000Z", { broken: true })],
        NOW,
      ),
    ).not.toThrow();

    const rows = computeContainersToday(
      null,
      [
        containerSample("2026-09-11T01:00:00.000Z", "not-json-array"),
        containerSample("2026-09-11T12:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 900, inputRecords: 9 },
        ]),
      ],
      [
        containerSample("2026-09-10T22:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 400, inputRecords: 4 },
        ]),
      ],
      NOW,
    );

    expect(rows).toEqual([
      { containerName: "hive-web", inputBytes: 500, inputRecords: 5 },
    ]);
  });

  it("returns null when live and stored containers are both empty", () => {
    expect(computeContainersToday(null, [], [], NOW)).toBeNull();
    expect(computeContainersToday([], [], [], NOW)).toBeNull();
    expect(
      computeContainersToday(
        null,
        [containerSample("2026-09-11T12:00:00.000Z", [])],
        [],
        NOW,
      ),
    ).toBeNull();
  });

  it("falls back to first-today when there is no pre-today baseline", () => {
    const rows = computeContainersToday(
      null,
      [
        containerSample("2026-09-11T01:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 100, inputRecords: 10 },
        ]),
        containerSample("2026-09-11T12:00:00.000Z", [
          { containerName: "hive-web", inputBytes: 400, inputRecords: 25 },
        ]),
      ],
      [],
      NOW,
    );

    expect(rows).toEqual([
      { containerName: "hive-web", inputBytes: 300, inputRecords: 15 },
    ]);
  });
});
