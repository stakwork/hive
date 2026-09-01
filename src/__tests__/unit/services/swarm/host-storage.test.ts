import { describe, test, expect, beforeEach, vi } from "vitest";
import type { SwarmCmdResponse } from "@/services/swarm/cmd";
import contractFixture from "@/services/swarm/__fixtures__/host-storage.contract.json";
import stackErrorFixture from "@/services/swarm/__fixtures__/host-storage.stack-error.json";
import partialErrorsFixture from "@/services/swarm/__fixtures__/host-storage.partial-errors.json";

// Mock fetch globally before importing (host-storage -> cmd -> fetch)
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { GET_HOST_STORAGE_CMD, fetchHostStorage, parseHostStorage } = await import(
  "@/services/swarm/host-storage"
);

type Body = Record<string, unknown>;

function clone(obj: unknown): Body {
  return JSON.parse(JSON.stringify(obj)) as Body;
}

/** The pinned contract body with errors[] emptied — a fully clean reading. */
function cleanContractBody(): Body {
  const body = clone(contractFixture);
  body.errors = [];
  return body;
}

function okResponse(data: unknown): SwarmCmdResponse {
  return { ok: true, status: 200, data, rawText: undefined };
}

describe("parseHostStorage — status classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("OK: clean well-formed body, no errors, governing filesystem resolved", () => {
    const reading = parseHostStorage(okResponse(cleanContractBody()));

    expect(reading.status).toBe("OK");
    expect(reading.reason).toBeUndefined();
    expect(reading.source).toBe("node_exporter");
    expect(reading.collectedAt).toBe(1730000000);
    expect(reading.cached).toBe(false);
    expect(reading.hostVisible).toBe(true);
    expect(reading.governingFilesystem?.mount).toBe("/");
    expect(reading.neo4j).toEqual({ volumes: ["neo4j.sphinx"], sizeBytes: 0, sizeKnown: true });
  });

  test("PARTIAL: well-formed body with non-empty errors[] (retained verbatim)", () => {
    const reading = parseHostStorage(okResponse(clone(contractFixture)));

    expect(reading.status).toBe("PARTIAL");
    expect(reading.reason).toBeUndefined();
    expect(reading.errors).toEqual([
      { collector: "volumes", reason: "docker df timed out after 8s" },
    ]);
    // Governing FS still resolved — the reading is usable.
    expect(reading.governingFilesystem?.mount).toBe("/");
  });

  test("PARTIAL: governing filesystem absent -> governing null + synthetic error (never first-entry fallback)", () => {
    const body = cleanContractBody();
    body.docker_root_filesystem = "/definitely/not/mounted";

    const reading = parseHostStorage(okResponse(body));

    expect(reading.status).toBe("PARTIAL");
    expect(reading.governingFilesystem).toBeNull();
    // filesystems[0] is NOT promoted to the governing slot
    expect(reading.filesystems).toHaveLength(1);
    expect(reading.errors).toEqual([
      { collector: "host_storage", reason: "governing filesystem not found" },
    ]);
  });

  test("ERROR: stack_error body (pinned fixture)", () => {
    const reading = parseHostStorage(okResponse(clone(stackErrorFixture)));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("STACK_ERROR");
    expect(reading.filesystems).toEqual([]);
    expect(reading.governingFilesystem).toBeNull();
  });

  test("ERROR: body that fails validation is MALFORMED, with no raw body echoed through", () => {
    const reading = parseHostStorage(
      okResponse({ source: 123, leaked: "SECRET_MARKER_RAW_BODY" }),
    );

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("MALFORMED");
    expect(JSON.stringify(reading)).not.toContain("SECRET_MARKER_RAW_BODY");
    expect("rawText" in reading).toBe(false);
  });

  test("UNREACHABLE: non-2xx response", () => {
    const reading = parseHostStorage({
      ok: false,
      status: 502,
      data: undefined,
      rawText: "Bad Gateway",
    });

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.reason).toBe("UNREACHABLE");
    expect(reading.governingFilesystem).toBeNull();
  });

  test("UNREACHABLE: timeout result from swarmCmdRequest (status 0, no body)", () => {
    const reading = parseHostStorage({
      ok: false,
      status: 0,
      data: null,
      rawText: "",
      errorCode: "TIMEOUT",
    });

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.reason).toBe("UNREACHABLE");
  });
});

describe("parseHostStorage — never fabricate a number", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("size_known: false and size_bytes: -1 map to null, never 0; a genuine 0 stays 0", () => {
    const body = cleanContractBody();
    body.volumes = [
      { name: "a", size_bytes: -1, size_known: true },
      { name: "b", size_bytes: 5, size_known: false },
      { name: "c", size_bytes: 0, size_known: true },
    ];
    body.neo4j = { volumes: ["a"], size_bytes: -1, size_known: true };

    const reading = parseHostStorage(okResponse(body));

    expect(reading.volumes.map((v) => v.sizeBytes)).toEqual([null, null, 0]);
    expect(reading.neo4j?.sizeBytes).toBeNull();
    expect(reading.neo4j?.sizeKnown).toBe(true);
    expect(reading.status).toBe("OK");
  });

  test("filesystem bytes of -1 map to null, never 0", () => {
    const body = cleanContractBody();
    body.filesystems = [
      { mount: "/", device: "/dev/x", fstype: "ext4", total_bytes: -1, used_bytes: 10, free_bytes: -1, describes_host: true },
    ];

    const reading = parseHostStorage(okResponse(body));

    expect(reading.filesystems[0].totalBytes).toBeNull();
    expect(reading.filesystems[0].usedBytes).toBe(10);
    expect(reading.filesystems[0].freeBytes).toBeNull();
  });

  test("neo4j: null is a valid, non-error reading", () => {
    const body = cleanContractBody();
    body.neo4j = null;

    const reading = parseHostStorage(okResponse(body));

    expect(reading.neo4j).toBeNull();
    expect(reading.status).toBe("OK");
  });

  test("host_visible is derived from filesystems[].describes_host, not trusted from the body", () => {
    const hidden = cleanContractBody();
    hidden.host_visible = true;
    hidden.filesystems = [
      { mount: "/", device: "/dev/x", fstype: "ext4", total_bytes: 1, used_bytes: 1, free_bytes: 1, describes_host: false },
    ];
    expect(parseHostStorage(okResponse(hidden)).hostVisible).toBe(false);

    const visible = cleanContractBody();
    visible.host_visible = false;
    visible.filesystems = [
      { mount: "/", device: "/dev/x", fstype: "ext4", total_bytes: 1, used_bytes: 1, free_bytes: 1, describes_host: true },
    ];
    expect(parseHostStorage(okResponse(visible)).hostVisible).toBe(true);
  });

  test("governing filesystem is matched by docker_root_filesystem when it is not /", () => {
    const body = cleanContractBody();
    body.filesystems = [
      { mount: "/", device: "/dev/nvme0n1p1", fstype: "ext4", total_bytes: 100, used_bytes: 50, free_bytes: 50, describes_host: true },
      { mount: "/mnt/data", device: "/dev/sdb1", fstype: "xfs", total_bytes: 1000, used_bytes: 900, free_bytes: 100, describes_host: true },
    ];
    body.docker_root_filesystem = "/mnt/data";

    const reading = parseHostStorage(okResponse(body));

    expect(reading.status).toBe("OK");
    expect(reading.governingFilesystem?.mount).toBe("/mnt/data");
    expect(reading.governingFilesystem?.freeBytes).toBe(100);
  });
});

describe("parseHostStorage — Zod hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("arrays are capped at 64 entries", () => {
    const body = cleanContractBody();
    body.filesystems = Array.from({ length: 70 }, () => ({
      mount: "/",
      device: "/dev/x",
      fstype: "ext4",
      total_bytes: 1,
      used_bytes: 1,
      free_bytes: 1,
      describes_host: false,
    }));
    body.volumes = Array.from({ length: 70 }, (_, i) => ({ name: `v${i}`, size_bytes: 1, size_known: true }));
    body.errors = Array.from({ length: 70 }, (_, i) => ({ collector: `c${i}`, reason: "r" }));

    const reading = parseHostStorage(okResponse(body));

    expect(reading.filesystems).toHaveLength(64);
    expect(reading.volumes).toHaveLength(64);
    expect(reading.errors).toHaveLength(64);
    expect(reading.status).toBe("PARTIAL");
  });

  test("the synthetic governing error survives errors[] capping", () => {
    const body = cleanContractBody();
    body.errors = Array.from({ length: 70 }, (_, i) => ({ collector: `c${i}`, reason: "r" }));
    body.docker_root_filesystem = "/not/mounted";

    const reading = parseHostStorage(okResponse(body));

    expect(reading.errors).toHaveLength(64);
    expect(reading.errors[63]).toEqual({
      collector: "host_storage",
      reason: "governing filesystem not found",
    });
  });

  test("strings are truncated to 256 characters", () => {
    const body = cleanContractBody();
    const long = "x".repeat(1000);
    body.docker_root_dir = long;
    body.filesystems = [
      { mount: long, device: long, fstype: long, total_bytes: 1, used_bytes: 1, free_bytes: 1, describes_host: true },
    ];
    body.volumes = [{ name: long, size_bytes: 1, size_known: true }];
    body.errors = [{ collector: long, reason: long }];

    const reading = parseHostStorage(okResponse(body));

    expect(reading.dockerRootDir).toHaveLength(256);
    expect(reading.filesystems[0].mount).toHaveLength(256);
    expect(reading.filesystems[0].device).toHaveLength(256);
    expect(reading.filesystems[0].fstype).toHaveLength(256);
    expect(reading.volumes[0].name).toHaveLength(256);
    expect(reading.errors[0].collector).toHaveLength(256);
    expect(reading.errors[0].reason).toHaveLength(256);
  });

  test("a body missing required fields fails validation as MALFORMED (with no raw echo)", () => {
    const body = cleanContractBody();
    delete body.collected_at;
    body.leaked = "SECRET_MARKER_MISSING_FIELD";

    const reading = parseHostStorage(okResponse(body));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("MALFORMED");
    expect(JSON.stringify(reading)).not.toContain("SECRET_MARKER_MISSING_FIELD");
  });

  test("non-2xx bodies are UNREACHABLE even when they parse as JSON", () => {
    const reading = parseHostStorage({
      ok: false,
      status: 500,
      data: clone(contractFixture),
    });

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.filesystems).toEqual([]);
  });
});

describe("parseHostStorage — pinned contract fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("host-storage.contract.json parses (verbatim body carries errors[] -> PARTIAL)", () => {
    const reading = parseHostStorage(okResponse(clone(contractFixture)));

    expect(reading.status).toBe("PARTIAL");
    expect(reading.source).toBe("node_exporter");
    expect(reading.hostVisible).toBe(true);
    expect(reading.governingFilesystem?.mount).toBe("/");
    expect(reading.neo4j).toEqual({ volumes: ["neo4j.sphinx"], sizeBytes: 0, sizeKnown: true });
    expect(reading.errors).toEqual([
      { collector: "volumes", reason: "docker df timed out after 8s" },
    ]);
  });

  test("host-storage.stack-error.json classifies as ERROR", () => {
    const reading = parseHostStorage(okResponse(clone(stackErrorFixture)));

    expect(reading.status).toBe("ERROR");
    expect(reading.reason).toBe("STACK_ERROR");
  });

  test("host-storage.partial-errors.json classifies as PARTIAL with unknown sizes as null", () => {
    const reading = parseHostStorage(okResponse(clone(partialErrorsFixture)));

    expect(reading.status).toBe("PARTIAL");
    expect(reading.source).toBe("container_bind");
    expect(reading.governingFilesystem?.freeBytes).toBe(64424509440);
    expect(reading.volumes[0]).toEqual({ name: "neo4j.sphinx", sizeBytes: null, sizeKnown: false });
    expect(reading.volumes[1]).toEqual({ name: "sphinx-data", sizeBytes: 536870912, sizeKnown: true });
    expect(reading.neo4j?.sizeBytes).toBeNull();
  });
});

describe("fetchHostStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("sends the GetHostStorage command built from the constant only", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({}) });

    await fetchHostStorage("https://swarm42.sphinx.chat", "jwt-token");

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain("https://swarm42.sphinx.chat:8800/api/cmd");
    const url = new URL(calledUrl);
    const txt = JSON.parse(url.searchParams.get("txt") as string);
    expect(txt).toEqual(GET_HOST_STORAGE_CMD);
    expect(txt).toEqual({ type: "Swarm", data: { cmd: "GetHostStorage" } });
    expect(Object.keys(txt.data)).toEqual(["cmd"]);
  });

  test("returns the parsed reading for a well-formed body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(cleanContractBody()),
    });

    const reading = await fetchHostStorage("https://swarm42.sphinx.chat", "jwt-token");

    expect(reading.status).toBe("OK");
    expect(reading.governingFilesystem?.mount).toBe("/");
  });

  test("maps the TIMEOUT errorCode to an UNREACHABLE reading", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 0, text: async () => "" });

    const reading = await fetchHostStorage("https://swarm42.sphinx.chat", "jwt-token");

    expect(reading.status).toBe("UNREACHABLE");
  });

  test("maps transport-level fetch failures to an UNREACHABLE reading (never throws)", async () => {
    mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND swarm42.sphinx.chat"));

    const reading = await fetchHostStorage("https://swarm42.sphinx.chat", "jwt-token");

    expect(reading.status).toBe("UNREACHABLE");
    expect(reading.reason).toBe("UNREACHABLE");
  });

  test("maps a malformed swarmUrl to an UNREACHABLE reading (CONFIG_INVALID, no throw)", async () => {
    const reading = await fetchHostStorage("not a url", "jwt-token");

    expect(reading.status).toBe("UNREACHABLE");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("passes timeoutMs through to the transport", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({}) });

    await fetchHostStorage("https://swarm42.sphinx.chat", "jwt-token", { timeoutMs: 1000 });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
