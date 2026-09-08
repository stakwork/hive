// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks — UI primitives only; the component under test uses the real
// formatBytes + plain text nodes.
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, ...props }: { children: React.ReactNode; className?: string } & Record<string, unknown>) => (
    <span data-testid="badge" className={className} {...props}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value, ...props }: { value?: number } & Record<string, unknown>) => (
    <div role="progressbar" data-value={value} {...props} />
  ),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <table {...props}>{children}</table>
  ),
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    className,
    ...props
  }: { children: React.ReactNode; className?: string } & Record<string, unknown>) => (
    <td className={className} {...props}>
      {children}
    </td>
  ),
  TableHead: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <tr {...props}>{children}</tr>
  ),
}));

vi.mock("@/app/admin/components/SwarmPasswordUpdateForm", () => ({
  default: ({
    workspaceId,
    hasPassword,
    onSuccess,
  }: {
    workspaceId: string;
    hasPassword: boolean;
    onSuccess: () => void;
  }) => (
    <div data-testid="swarm-password-update-form">
      <span data-testid="form-workspace-id">{workspaceId}</span>
      <span data-testid="form-has-password">{String(hasPassword)}</span>
      <button type="button" onClick={onSuccess} data-testid="form-success">
        Simulate success
      </button>
    </div>
  ),
}));

import HostStorageCard from "@/app/admin/swarms/[instanceId]/HostStorageCard";
import { formatBytes } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// Response builders (the wire shape of GET …/storage)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function volume(opts: {
  name: string;
  sizeBytes?: number | null;
  sizeKnown?: boolean;
  service?: string | null;
}): Json {
  return {
    name: opts.name,
    // Preserve explicit null — `?? 0` would fabricate a true-zero size.
    sizeBytes: opts.sizeBytes === undefined ? 0 : opts.sizeBytes,
    sizeKnown: opts.sizeKnown ?? true,
    service: opts.service === undefined ? null : opts.service,
  };
}

function serviceRollup(
  name: string,
  sizeBytes: number | null = 0,
  sizeKnown = true,
): Json {
  return { name, sizeBytes, sizeKnown };
}

const ANON_VOLUME =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function okReading(overrides: Json = {}): Json {
  const gov = {
    mount: "/",
    device: "/dev/nvme0n1p1",
    fstype: "ext4",
    totalBytes: 85899345920, // 80 GB
    usedBytes: 21474836480, // 20 GB
    freeBytes: 64424509440, // 60 GB
    describesHost: true,
  };
  return {
    status: "OK",
    hostVisible: true,
    source: "node_exporter",
    collectedAt: 1730000000,
    cached: false,
    filesystems: [gov],
    dockerRootDir: "/var/lib/docker",
    dockerRootFilesystem: "/",
    governingFilesystem: gov,
    volumes: [
      volume({
        name: "neo4j.sphinx",
        sizeBytes: 10737418240,
        sizeKnown: true,
        service: "neo4j",
      }),
    ],
    neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: 10737418240, sizeKnown: true },
    services: [],
    errors: [],
    ...overrides,
  };
}

function groupLabels(): string[] {
  return screen
    .getAllByTestId(/^volume-group-header-/)
    .map((el) => el.getAttribute("data-testid")!.slice("volume-group-header-".length));
}

function summaryRowNames(): string[] {
  return screen
    .getAllByTestId(/^service-usage-row-/)
    .map((el) => el.getAttribute("data-testid")!.slice("service-usage-row-".length));
}

const RUNNER_BYTES = 1.5 * 1024 * 1024; // 1.5 MB
const BITCOIND_BYTES = 7.2 * 1024 * 1024 * 1024; // 7.2 GB
const NEO4J_BYTES = 14.1 * 1024 * 1024 * 1024; // 14.1 GB
const RESIDUAL_NEO4J_BYTES = 572 * 1024; // 572 KB
const LND_BYTES = 100 * 1024 * 1024; // 100 MB
const LND_VOL_A = 60 * 1024 * 1024;
const LND_VOL_B = 40 * 1024 * 1024;

function freshResponse(reading: Json): Json {
  return { outcome: "fresh", reading, collectedAt: reading.collectedAt, cached: false };
}

function fetchResponse(body: Json | null, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

async function renderWithFetch(response: ReturnType<typeof fetchResponse>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  render(React.createElement(HostStorageCard, { instanceId: "i-0abc123def" }));
  return fetchMock;
}

describe("HostStorageCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the headline free bytes, Progress bar and figures for a fresh OK reading", async () => {
    const reading = okReading();
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("free-bytes")).toHaveTextContent("60 GB");
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("source-badge")).toHaveTextContent("node_exporter");
    expect(screen.getByText(/Collected: 2024-10-27 03:33/)).toBeInTheDocument();
    expect(screen.queryByTestId("cached-label")).not.toBeInTheDocument();
  });

  it("renders 'unknown' for null figures, never a fabricated 0", async () => {
    const reading = okReading({
      filesystems: [
        {
          mount: "/",
          device: "/dev/nvme0n1p1",
          fstype: "ext4",
          totalBytes: null,
          usedBytes: null,
          freeBytes: null,
          describesHost: true,
        },
      ],
      governingFilesystem: null,
      volumes: [
        { name: "neo4j.sphinx", sizeBytes: null, sizeKnown: false },
        { name: "sphinx-data", sizeBytes: 536870912, sizeKnown: true },
      ],
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: null, sizeKnown: false },
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/0 B/)).not.toBeInTheDocument();
    // No progress bar without known capacity.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // Known volume sizes still render precisely (row, not the group header).
    expect(screen.getByTestId("volume-row-sphinx-data")).toHaveTextContent("512 MB");
  });

  it("renders 'Not present' when neo4j is null, not an error", async () => {
    const reading = okReading({ neo4j: null });
    // The neo4j volume stays in the volumes list, so "other volumes" = all.
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("neo4j-absent")).toHaveTextContent("Not present");
    });
    expect(screen.queryByTestId("neo4j-size")).not.toBeInTheDocument();
  });

  it("with host_visible: false, suppresses host-capacity figures and the Progress bar but keeps volume and Neo4j sizes", async () => {
    const reading = okReading({
      hostVisible: false,
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: 10737418240, sizeKnown: true },
      volumes: [
        { name: "neo4j.sphinx", sizeBytes: 10737418240, sizeKnown: true },
        { name: "sphinx-data", sizeBytes: 536870912, sizeKnown: true },
      ],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("host-invisible-notice")).toBeInTheDocument();
    });
    expect(screen.getByText(/could not see the host/i)).toBeInTheDocument();
    // Host-capacity figures suppressed:
    expect(screen.queryByTestId("host-capacity")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("free-bytes")).not.toBeInTheDocument();
    // Container-level readings stay visible:
    expect(screen.getByText(/Size: 10 GB/)).toBeInTheDocument();
    expect(screen.getByTestId("volume-row-sphinx-data")).toHaveTextContent("512 MB");
  });

  it("renders errors[] as inline warnings alongside a valid PARTIAL reading", async () => {
    const reading = okReading({
      status: "PARTIAL",
      errors: [{ collector: "volumes", reason: "docker df timed out after 8s" }],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("errors-warnings")).toBeInTheDocument();
    });
    expect(screen.getByText(/volumes: docker df timed out after 8s/)).toBeInTheDocument();
    // The rest of the reading is still shown (partial success, not failure).
    expect(screen.getByTestId("free-bytes")).toBeInTheDocument();
  });

  it("labels a cached reading as cached, with the original collection time", async () => {
    const reading = okReading();
    const response = {
      outcome: "cached",
      reading,
      collectedAt: 1730000000,
      cached: true,
    };
    await renderWithFetch(fetchResponse(response));

    await waitFor(() => {
      const label = screen.getByTestId("cached-label");
      expect(label).toHaveTextContent(/Cached reading from/);
      expect(label).toHaveTextContent(/2024-10-27 03:33/);
    });
  });

  it("renders 'unreachable now' and 'no linked swarm record' as visibly distinct states", async () => {
    await renderWithFetch(fetchResponse({ outcome: "unreachable", reasonCode: "TIMEOUT", cached: false }));
    await waitFor(() => {
      expect(screen.getByText(/couldn't reach the swarm just now/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/reason: TIMEOUT/i)).toBeInTheDocument();
    expect(screen.queryByText(/no linked swarm record/i)).not.toBeInTheDocument();

    // Now the no-record state (fresh render).
    cleanup();
    await renderWithFetch(fetchResponse({ outcome: "no_swarm_record", reasonCode: "NO_SWARM_RECORD", cached: false }));
    await waitFor(() => {
      expect(screen.getByText(/no linked swarm record/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/couldn't reach the swarm just now/i)).not.toBeInTheDocument();
    expect(screen.getByText(/telemetry is unavailable/i)).toBeInTheDocument();
  });

  it("renders explanatory copy for a failed read (e.g. CONFIG_INVALID) rather than a blank error", async () => {
    await renderWithFetch(
      fetchResponse({ outcome: "failed", reasonCode: "CONFIG_INVALID", cached: false }),
    );
    await waitFor(() => {
      expect(screen.getByText(/not configured for host storage reads/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/CONFIG_INVALID/)).toBeInTheDocument();
  });

  it("renders a 409 ambiguous outcome as its own distinct state", async () => {
    await renderWithFetch(fetchResponse({ outcome: "ambiguous", reasonCode: "AMBIGUOUS", cached: false }, true, 409));
    await waitFor(() => {
      expect(screen.getByText(/multiple linked swarm records/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/rather than an arbitrary one/i)).toBeInTheDocument();
  });

  it("Refresh re-issues the same GET", async () => {
    const reading = okReading();
    const fetchMock = await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("free-bytes")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/swarms/i-0abc123def/storage", {
      method: "GET",
    });
  });

  it("renders SwarmPasswordUpdateForm only for DECRYPT_FAILED with a workspaceId", async () => {
    await renderWithFetch(
      fetchResponse({
        outcome: "failed",
        reasonCode: "DECRYPT_FAILED",
        workspaceId: "ws-decrypt",
        cached: false,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/could not be decrypted/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId("swarm-password-update-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-workspace-id")).toHaveTextContent("ws-decrypt");
    expect(screen.getByTestId("form-has-password")).toHaveTextContent("true");
  });

  it("does not render SwarmPasswordUpdateForm for other failed reason codes", async () => {
    await renderWithFetch(
      fetchResponse({ outcome: "failed", reasonCode: "CONFIG_INVALID", cached: false }),
    );

    await waitFor(() => {
      expect(screen.getByText(/not configured for host storage reads/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("swarm-password-update-form")).not.toBeInTheDocument();
  });

  it("does not render SwarmPasswordUpdateForm for DECRYPT_FAILED without workspaceId", async () => {
    await renderWithFetch(
      fetchResponse({ outcome: "failed", reasonCode: "DECRYPT_FAILED", cached: false }),
    );

    await waitFor(() => {
      expect(screen.getByText(/could not be decrypted/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("swarm-password-update-form")).not.toBeInTheDocument();
  });

  it("re-fetches storage when SwarmPasswordUpdateForm succeeds", async () => {
    const fetchMock = await renderWithFetch(
      fetchResponse({
        outcome: "failed",
        reasonCode: "DECRYPT_FAILED",
        workspaceId: "ws-decrypt",
        cached: false,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("swarm-password-update-form")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("form-success"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/swarms/i-0abc123def/storage", {
      method: "GET",
    });
  });

  it("truncates over-long swarm-derived strings for display (plain text only)", async () => {
    const longName = "v".repeat(200);
    const reading = okReading({
      volumes: [volume({ name: longName, sizeBytes: 1024, sizeKnown: true, service: "alice" })],
      neo4j: null,
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      const cell = screen.getByText(/^v+…$/);
      expect(cell.textContent?.length).toBe(81); // 80 chars + ellipsis
    });
  });

  it("does not render a second Neo4j group for a services[] entry named neo4j", async () => {
    const reading = okReading({
      volumes: [
        volume({
          name: "neo4j.sphinx",
          sizeBytes: 10737418240,
          sizeKnown: true,
          service: "neo4j",
        }),
        volume({ name: "alice-data", sizeBytes: 1024, sizeKnown: true, service: "alice" }),
      ],
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: 10737418240, sizeKnown: true },
      services: [serviceRollup("neo4j"), serviceRollup("alice")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("docker-volumes")).toBeInTheDocument();
    });
    expect(screen.getByTestId("neo4j-size")).toBeInTheDocument();
    expect(screen.queryByTestId("volume-group-header-neo4j")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-usage-row-neo4j")).not.toBeInTheDocument();
    expect(screen.getByTestId("volume-row-alice-data")).toBeInTheDocument();
    expect(screen.queryByTestId("volume-group-header-alice")).not.toBeInTheDocument();
  });

  it("groups volumes sharing a service under one header, ordered by reading.services", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "bob-vol", sizeBytes: 2048, sizeKnown: true, service: "bob" }),
        volume({ name: "alice-b", sizeBytes: 512, sizeKnown: true, service: "alice" }),
        volume({ name: "alice-a", sizeBytes: 256, sizeKnown: true, service: "alice" }),
      ],
      neo4j: null,
      services: [serviceRollup("bob"), serviceRollup("alice")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-row-bob-vol")).toBeInTheDocument();
    });
    // Single-volume summarized services collapse (no header); multi-volume keep a label-only header.
    // Group order still follows reading.services (bob, then alice).
    expect(screen.queryByTestId("volume-group-header-bob")).not.toBeInTheDocument();
    expect(screen.getByTestId("volume-group-header-alice")).toHaveTextContent("alice");
    expect(screen.queryByTestId("volume-group-total-alice")).not.toBeInTheDocument();
    const tableRows = screen.getByTestId("docker-volumes").querySelectorAll("tbody tr");
    expect([...tableRows].map((row) => row.getAttribute("data-testid"))).toEqual([
      "volume-row-bob-vol",
      "volume-group-header-alice",
      "volume-row-alice-a",
      "volume-row-alice-b",
    ]);
    expect(screen.getByTestId("volume-row-alice-a").querySelector("td")?.className).toContain("pl-6");
  });

  it("still renders a volume whose owner is absent from services[] in its own group", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "listed-vol", sizeBytes: 1024, sizeKnown: true, service: "alice" }),
        volume({ name: "orphan-owner", sizeBytes: 2048, sizeKnown: true, service: "charlie" }),
      ],
      neo4j: null,
      services: [serviceRollup("alice")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-row-orphan-owner")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("volume-group-header-alice")).not.toBeInTheDocument();
    expect(groupLabels()).toEqual(["charlie"]);
    expect(screen.getByTestId("volume-group-total-charlie")).toHaveTextContent("2 KB");
  });

  it("renders null-owner volumes under Unattributed, last", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "orphan-null", sizeBytes: 4096, sizeKnown: true, service: null }),
        volume({ name: "orphan-empty", sizeBytes: 2048, sizeKnown: true, service: "" }),
        volume({ name: "alice-data", sizeBytes: 1024, sizeKnown: true, service: "alice" }),
      ],
      neo4j: null,
      services: [serviceRollup("alice")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-group-header-Unattributed")).toBeInTheDocument();
    });
    expect(groupLabels()).toEqual(["Unattributed"]);
    expect(screen.getByTestId("volume-group-total-Unattributed")).toHaveTextContent("6 KB");
    expect(screen.getByTestId("volume-row-orphan-null")).toBeInTheDocument();
    expect(screen.getByTestId("volume-row-orphan-empty")).toBeInTheDocument();
  });

  it("shows header total unknown when any member is unmeasurable, and 0 B for true-zero groups", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "bob-known", sizeBytes: 1024, sizeKnown: true, service: "bob" }),
        volume({ name: "bob-unknown", sizeBytes: null, sizeKnown: false, service: "bob" }),
        volume({ name: "empty-a", sizeBytes: 0, sizeKnown: true, service: "empty" }),
        volume({ name: "empty-b", sizeBytes: 0, sizeKnown: true, service: "empty" }),
      ],
      neo4j: null,
      // Unlisted services keep header totals (summarized services no longer print a rollup).
      services: [],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-group-total-bob")).toHaveTextContent("unknown");
    });
    expect(screen.getByTestId("volume-group-total-empty")).toHaveTextContent("0 B");
    expect(screen.getByTestId("volume-row-empty-a")).toHaveTextContent("0 B");
    expect(screen.getByTestId("volume-row-bob-unknown")).toHaveTextContent("unknown");
  });

  it("sorts rows within a group by name ascending", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "zeta", sizeBytes: 1, sizeKnown: true, service: "alice" }),
        volume({ name: "alpha", sizeBytes: 2, sizeKnown: true, service: "alice" }),
        volume({ name: "mid", sizeBytes: 3, sizeKnown: true, service: "alice" }),
      ],
      neo4j: null,
      services: [serviceRollup("alice")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-row-alpha")).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId(/^volume-row-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "volume-row-alpha",
      "volume-row-mid",
      "volume-row-zeta",
    ]);
  });

  it("shortens a 64-hex volume name and shows the owning service inline", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: ANON_VOLUME, sizeBytes: 1024, sizeKnown: true, service: "alice" }),
      ],
      neo4j: null,
      services: [serviceRollup("alice")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId(`volume-row-${ANON_VOLUME}`)).toBeInTheDocument();
    });
    const row = screen.getByTestId(`volume-row-${ANON_VOLUME}`);
    expect(row).toHaveTextContent("0123456789ab…");
    expect(row).toHaveTextContent("alice");
    expect(row.textContent).not.toContain(ANON_VOLUME);
    expect(within(row).getByText("alice")).toBeInTheDocument();
  });

  it("renders formatBytes(null) as unknown and formatBytes(0) as 0 B, distinguishable in the DOM", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "zero-vol", sizeBytes: 0, sizeKnown: true, service: "alice" }),
        volume({ name: "unknown-vol", sizeBytes: null, sizeKnown: false, service: "bob" }),
      ],
      neo4j: null,
      services: [serviceRollup("alice"), serviceRollup("bob")],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-row-zero-vol")).toBeInTheDocument();
    });
    const zeroRow = screen.getByTestId("volume-row-zero-vol");
    const unknownRow = screen.getByTestId("volume-row-unknown-vol");
    expect(within(zeroRow).getByText("0 B")).toBeInTheDocument();
    expect(within(unknownRow).getByText("unknown")).toBeInTheDocument();
    expect(screen.queryByTestId("volume-group-total-alice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("volume-group-total-bob")).not.toBeInTheDocument();
    expect(within(zeroRow).queryByText("unknown")).not.toBeInTheDocument();
    expect(within(unknownRow).queryByText("0 B")).not.toBeInTheDocument();
  });

  it("renders a per-service summary largest-first, unknown last, excluding neo4j", async () => {
    const reading = okReading({
      volumes: [
        volume({
          name: "neo4j.sphinx",
          sizeBytes: NEO4J_BYTES,
          sizeKnown: true,
          service: "neo4j",
        }),
      ],
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: NEO4J_BYTES, sizeKnown: true },
      services: [
        serviceRollup("runner", RUNNER_BYTES, true),
        serviceRollup("cln", null, false),
        serviceRollup("bitcoind", BITCOIND_BYTES, true),
        serviceRollup("neo4j", NEO4J_BYTES, true),
        serviceRollup("lnd", LND_BYTES, true),
      ],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("service-usage-summary")).toBeInTheDocument();
    });
    expect(summaryRowNames()).toEqual(["bitcoind", "lnd", "runner", "cln"]);
    expect(screen.getByTestId("service-usage-row-bitcoind")).toHaveTextContent(
      formatBytes(BITCOIND_BYTES),
    );
    expect(screen.getByTestId("service-usage-row-lnd")).toHaveTextContent(formatBytes(LND_BYTES));
    expect(screen.getByTestId("service-usage-row-runner")).toHaveTextContent(
      formatBytes(RUNNER_BYTES),
    );
    expect(screen.getByTestId("service-usage-row-cln")).toHaveTextContent("unknown");
    expect(screen.queryByTestId("service-usage-row-neo4j")).not.toBeInTheDocument();
  });

  it("does not render a residual neo4j table group for volumes named outside neo4j.volumes", async () => {
    const reading = okReading({
      volumes: [
        volume({
          name: "neo4j.sphinx",
          sizeBytes: NEO4J_BYTES,
          sizeKnown: true,
          service: "neo4j",
        }),
        volume({
          name: "neo4j-logs",
          sizeBytes: RESIDUAL_NEO4J_BYTES,
          sizeKnown: true,
          service: "neo4j",
        }),
        volume({
          name: "runner.sphinx",
          sizeBytes: RUNNER_BYTES,
          sizeKnown: true,
          service: "runner",
        }),
      ],
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: NEO4J_BYTES, sizeKnown: true },
      services: [serviceRollup("neo4j", NEO4J_BYTES, true), serviceRollup("runner", RUNNER_BYTES, true)],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("neo4j-size")).toHaveTextContent(formatBytes(NEO4J_BYTES));
    });
    expect(screen.getByTestId("neo4j-size")).toHaveTextContent("14.1 GB");
    expect(screen.queryByTestId("volume-group-header-neo4j")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-usage-row-neo4j")).not.toBeInTheDocument();
    expect(screen.queryByTestId("volume-row-neo4j-logs")).not.toBeInTheDocument();
    expect(screen.getByTestId("docker-volumes")).not.toHaveTextContent("572 KB");
  });

  it("collapses a single-volume summarized service into one row with the size printed once", async () => {
    const reading = okReading({
      volumes: [
        volume({
          name: "runner.sphinx",
          sizeBytes: RUNNER_BYTES,
          sizeKnown: true,
          service: "runner",
        }),
      ],
      neo4j: null,
      services: [serviceRollup("runner", RUNNER_BYTES, true)],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-row-runner.sphinx")).toBeInTheDocument();
    });
    const table = screen.getByTestId("docker-volumes");
    expect(within(table).queryByTestId("volume-group-header-runner")).not.toBeInTheDocument();
    expect(within(table).getAllByText(formatBytes(RUNNER_BYTES))).toHaveLength(1);
    expect(screen.getByTestId("volume-row-runner.sphinx")).toHaveTextContent("runner");
    expect(screen.getByTestId("volume-row-runner.sphinx")).toHaveTextContent("runner.sphinx");
  });

  it("renders a label-only header and indented members for a multi-volume summarized service", async () => {
    const reading = okReading({
      volumes: [
        volume({ name: "lnd-macaroon", sizeBytes: LND_VOL_A, sizeKnown: true, service: "lnd" }),
        volume({ name: "lnd-data", sizeBytes: LND_VOL_B, sizeKnown: true, service: "lnd" }),
      ],
      neo4j: null,
      services: [serviceRollup("lnd", LND_BYTES, true)],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-group-header-lnd")).toBeInTheDocument();
    });
    const header = screen.getByTestId("volume-group-header-lnd");
    expect(header).toHaveTextContent("lnd");
    expect(screen.queryByTestId("volume-group-total-lnd")).not.toBeInTheDocument();
    expect(header).not.toHaveTextContent(formatBytes(LND_BYTES));
    expect(header).not.toHaveTextContent(formatBytes(LND_VOL_A));
    expect(header).not.toHaveTextContent(formatBytes(LND_VOL_B));

    const macaroon = screen.getByTestId("volume-row-lnd-macaroon");
    const dataRow = screen.getByTestId("volume-row-lnd-data");
    expect(macaroon.querySelector("td")?.className).toContain("pl-6");
    expect(dataRow.querySelector("td")?.className).toContain("pl-6");
    expect(macaroon).toHaveTextContent(formatBytes(LND_VOL_A));
    expect(dataRow).toHaveTextContent(formatBytes(LND_VOL_B));
    expect(screen.getByTestId("service-usage-row-lnd")).toHaveTextContent(formatBytes(LND_BYTES));
  });

  it("keeps the Unattributed group header with formatBytes(group.total) unchanged", async () => {
    const reading = okReading({
      volumes: [
        volume({
          name: "bitcoind.sphinx",
          sizeBytes: BITCOIND_BYTES,
          sizeKnown: true,
          service: null,
        }),
        volume({
          name: "runner.sphinx",
          sizeBytes: RUNNER_BYTES,
          sizeKnown: true,
          service: "runner",
        }),
      ],
      neo4j: null,
      services: [serviceRollup("runner", RUNNER_BYTES, true)],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("volume-group-header-Unattributed")).toBeInTheDocument();
    });
    expect(screen.getByTestId("volume-group-total-Unattributed")).toHaveTextContent(
      formatBytes(BITCOIND_BYTES),
    );
    expect(screen.getByTestId("volume-row-bitcoind.sphinx")).toHaveTextContent(
      formatBytes(BITCOIND_BYTES),
    );
    expect(groupLabels()).toEqual(["Unattributed"]);
  });

  it("does not render a service-usage summary when services is empty", async () => {
    const reading = okReading();
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("neo4j-size")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("service-usage-summary")).not.toBeInTheDocument();
  });
});
