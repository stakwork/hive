// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

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
  Badge: ({
    children,
    className,
    ...props
  }: { children: React.ReactNode; className?: string } & Record<string, unknown>) => (
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

import FluentbitStatsCard from "@/app/admin/swarms/[instanceId]/FluentbitStatsCard";

type Json = Record<string, unknown>;

const NULL_RATES = {
  inputBytesPerSec: null,
  inputRecordsPerSec: null,
  outputProcBytesPerSec: null,
  outputProcRecordsPerSec: null,
};

function okReading(overrides: Json = {}): Json {
  return {
    status: "OK",
    available: true,
    collectedAt: 1730000000,
    inputBytes: 12345,
    inputRecords: 67,
    outputProcBytes: 12000,
    outputProcRecords: 65,
    filterDropRecords: 0,
    outputDroppedRecords: 0,
    outputErrors: 0,
    retriesFailed: 0,
    uptimeSeconds: 3600,
    errors: [],
    rates: {
      inputBytesPerSec: 192.89,
      inputRecordsPerSec: 1.05,
      outputProcBytesPerSec: 187.5,
      outputProcRecordsPerSec: 1.02,
    },
    rateWindowSeconds: 64,
    ...overrides,
  };
}

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
  render(React.createElement(FluentbitStatsCard, { instanceId: "i-0abc123def" }));
  return fetchMock;
}

const VOLUME_COUNTER_KEYS = [
  "inputBytes",
  "inputRecords",
  "outputProcBytes",
  "outputProcRecords",
] as const;

const ALL_COUNTER_KEYS = [
  ...VOLUME_COUNTER_KEYS,
  "filterDropRecords",
  "outputDroppedRecords",
  "outputErrors",
  "retriesFailed",
  "uptimeSeconds",
] as const;

describe("FluentbitStatsCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders raw counters and windowed rates for a full OK reading", async () => {
    await renderWithFetch(fetchResponse(freshResponse(okReading())));

    await waitFor(() => {
      expect(screen.getByTestId("fluentbit-status-badge")).toHaveTextContent("OK");
    });

    expect(screen.getByText("FluentBit Stats")).toBeInTheDocument();
    expect(screen.getByText(/Collected: 2024-10-27 03:33/)).toBeInTheDocument();
    expect(screen.queryByTestId("cached-label")).not.toBeInTheDocument();

    expect(screen.getByTestId("counter-inputBytes")).toHaveTextContent("12.1 KB");
    expect(screen.getByTestId("counter-inputRecords")).toHaveTextContent("67");
    expect(screen.getByTestId("counter-outputProcBytes")).toHaveTextContent("11.7 KB");
    expect(screen.getByTestId("counter-outputProcRecords")).toHaveTextContent("65");
    expect(screen.getByTestId("counter-filterDropRecords")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-outputDroppedRecords")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-outputErrors")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-retriesFailed")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-uptimeSeconds")).toHaveTextContent("3,600");

    expect(screen.getByTestId("rate-inputBytes")).toHaveTextContent("192.9 B/s over last 64s");
    expect(screen.getByTestId("rate-inputRecords")).toHaveTextContent("1.05/s over last 64s");
    expect(screen.getByTestId("rate-outputProcBytes")).toHaveTextContent("187.5 B/s over last 64s");
    expect(screen.getByTestId("rate-outputProcRecords")).toHaveTextContent("1.02/s over last 64s");
  });

  it("renders a null counter as unavailable and a true 0 as 0, never mixing the two", async () => {
    const reading = okReading({
      inputBytes: null,
      inputRecords: 0,
      outputProcBytes: 0,
      outputProcRecords: null,
      filterDropRecords: 0,
      outputDroppedRecords: null,
      outputErrors: 0,
      retriesFailed: null,
      uptimeSeconds: 0,
      rates: NULL_RATES,
      rateWindowSeconds: null,
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("fluentbit-counters")).toBeInTheDocument();
    });

    expect(screen.getByTestId("counter-inputBytes")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-inputRecords")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-inputRecords")).not.toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-outputProcBytes")).toHaveTextContent("0 B");
    expect(screen.getByTestId("counter-outputProcBytes")).not.toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-outputProcRecords")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-filterDropRecords")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-outputDroppedRecords")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-outputErrors")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-retriesFailed")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-uptimeSeconds")).toHaveTextContent("0");
    expect(screen.getByTestId("counter-uptimeSeconds")).not.toHaveTextContent("unavailable");
  });

  it("renders every field as unavailable for UNAVAILABLE without blanking the card", async () => {
    const reading = okReading({
      status: "UNAVAILABLE",
      available: false,
      errors: [],
      rates: NULL_RATES,
      rateWindowSeconds: null,
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("fluentbit-status-badge")).toHaveTextContent("UNAVAILABLE");
    });

    expect(screen.getByText("FluentBit Stats")).toBeInTheDocument();
    expect(screen.getByText("Input bytes")).toBeInTheDocument();
    expect(screen.getByText("Uptime (seconds)")).toBeInTheDocument();
    expect(screen.getByTestId("unavailable-notice")).toBeInTheDocument();
    expect(screen.getByTestId("fluentbit-counters")).toBeInTheDocument();

    for (const key of ALL_COUNTER_KEYS) {
      expect(screen.getByTestId(`counter-${key}`)).toHaveTextContent("unavailable");
    }
    for (const key of VOLUME_COUNTER_KEYS) {
      expect(screen.getByTestId(`rate-${key}`)).toHaveTextContent("unavailable");
    }
    expect(screen.queryByText("12.1 KB")).not.toBeInTheDocument();
    expect(screen.queryByText("3,600")).not.toBeInTheDocument();
  });

  it("renders arrived PARTIAL fields plus a truncated errors list, leaving nulls unavailable", async () => {
    const longError = `${"collector timed out while scraping fluentbit metrics ".repeat(3)}end`;
    const reading = okReading({
      status: "PARTIAL",
      inputBytes: 2048,
      inputRecords: null,
      outputProcBytes: 0,
      outputProcRecords: 4,
      filterDropRecords: null,
      errors: [longError, "drop filter unavailable"],
      rates: {
        inputBytesPerSec: 32,
        inputRecordsPerSec: null,
        outputProcBytesPerSec: 0,
        outputProcRecordsPerSec: 0.1,
      },
      rateWindowSeconds: 64,
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("fluentbit-status-badge")).toHaveTextContent("PARTIAL");
    });

    expect(screen.getByTestId("counter-inputBytes")).toHaveTextContent("2 KB");
    expect(screen.getByTestId("counter-inputRecords")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("counter-outputProcBytes")).toHaveTextContent("0 B");
    expect(screen.getByTestId("counter-outputProcRecords")).toHaveTextContent("4");
    expect(screen.getByTestId("counter-filterDropRecords")).toHaveTextContent("unavailable");

    expect(screen.getByTestId("rate-inputBytes")).toHaveTextContent("32 B/s over last 64s");
    expect(screen.getByTestId("rate-inputRecords")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("rate-outputProcBytes")).toHaveTextContent("0/s over last 64s");

    const warnings = screen.getByTestId("errors-warnings");
    expect(warnings).toBeInTheDocument();
    expect(warnings).toHaveTextContent("drop filter unavailable");
    expect(warnings.textContent ?? "").toMatch(/…/);
    expect((warnings.textContent ?? "").includes(longError)).toBe(false);
    expect(screen.getByText(/partial reading/i)).toBeInTheDocument();
  });

  it("keeps rates unavailable on a cached first-sample reading and does not recompute a client-side delta", async () => {
    const firstSample = okReading({
      inputBytes: 1000,
      inputRecords: 10,
      outputProcBytes: 800,
      outputProcRecords: 8,
      rates: NULL_RATES,
      rateWindowSeconds: null,
    });
    const secondSample = okReading({
      collectedAt: 1730000060,
      inputBytes: 2260,
      inputRecords: 70,
      outputProcBytes: 2000,
      outputProcRecords: 68,
      rates: NULL_RATES,
      rateWindowSeconds: null,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        fetchResponse({
          outcome: "cached",
          reading: firstSample,
          collectedAt: firstSample.collectedAt,
          cached: true,
        }),
      )
      .mockResolvedValueOnce(fetchResponse(freshResponse(secondSample)));
    vi.stubGlobal("fetch", fetchMock);
    render(React.createElement(FluentbitStatsCard, { instanceId: "i-0abc123def" }));

    await waitFor(() => {
      expect(screen.getByTestId("cached-label")).toHaveTextContent(/Cached reading from/);
    });
    expect(screen.getByTestId("counter-inputBytes")).toHaveTextContent("1000 B");
    for (const key of VOLUME_COUNTER_KEYS) {
      expect(screen.getByTestId(`rate-${key}`)).toHaveTextContent("unavailable");
    }

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByTestId("counter-inputBytes")).toHaveTextContent("2.2 KB");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const key of VOLUME_COUNTER_KEYS) {
      expect(screen.getByTestId(`rate-${key}`)).toHaveTextContent("unavailable");
    }
    expect(screen.queryByText(/over last/)).not.toBeInTheDocument();
    expect(screen.queryByText(/21\.0 B\/s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1\/s/)).not.toBeInTheDocument();
  });

  it("renders 'unreachable now' and 'no linked swarm record' as visibly distinct states", async () => {
    await renderWithFetch(
      fetchResponse({ outcome: "unreachable", reasonCode: "TIMEOUT", cached: false }),
    );
    await waitFor(() => {
      expect(screen.getByText(/couldn't reach the swarm just now/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/reason: TIMEOUT/i)).toBeInTheDocument();
    expect(screen.queryByText(/no linked swarm record/i)).not.toBeInTheDocument();

    cleanup();
    await renderWithFetch(
      fetchResponse({ outcome: "no_swarm_record", reasonCode: "NO_SWARM_RECORD", cached: false }),
    );
    await waitFor(() => {
      expect(screen.getByText(/no linked swarm record/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/couldn't reach the swarm just now/i)).not.toBeInTheDocument();
    expect(screen.getByText(/fluentbit stats are unavailable/i)).toBeInTheDocument();
  });

  it("renders a 409 ambiguous outcome as its own distinct state", async () => {
    await renderWithFetch(
      fetchResponse({ outcome: "ambiguous", reasonCode: "AMBIGUOUS", cached: false }, true, 409),
    );
    await waitFor(() => {
      expect(screen.getByText(/multiple linked swarm records/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/rather than an arbitrary one/i)).toBeInTheDocument();
  });

  it.each([
    ["CONFIG_INVALID", /not configured for fluentbit stats reads/i],
    ["AUTH_FAILED", /swarm authentication failed/i],
    ["DECRYPT_FAILED", /could not be decrypted/i],
    ["STACK_ERROR", /transport-level error/i],
    ["MALFORMED", /invalid fluentbit stats response/i],
    ["WORKSPACE_DELETED", /workspace linked to this swarm is deleted/i],
  ] as const)("renders failed %s copy without a password recovery form", async (reasonCode, title) => {
    await renderWithFetch(
      fetchResponse({
        outcome: "failed",
        reasonCode,
        workspaceId: "ws-1",
        cached: false,
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
    expect(screen.getByText(new RegExp(reasonCode))).toBeInTheDocument();
    expect(screen.queryByTestId("swarm-password-update-form")).not.toBeInTheDocument();
  });

  it("Refresh re-issues the same GET", async () => {
    const fetchMock = await renderWithFetch(fetchResponse(freshResponse(okReading())));

    await waitFor(() => {
      expect(screen.getByTestId("fluentbit-status-badge")).toHaveTextContent("OK");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/admin/swarms/i-0abc123def/fluentbit", {
      method: "GET",
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/swarms/i-0abc123def/fluentbit", {
      method: "GET",
    });
  });

  it("shows a network error with Retry when fetch throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(React.createElement(FluentbitStatsCard, { instanceId: "i-0abc123def" }));

    await waitFor(() => {
      expect(screen.getByText(/network error while fetching fluentbit stats/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  const SAMPLE_INGEST = {
    today: { inputBytes: 4096, inputRecords: 12 },
    yesterday: { inputBytes: null, inputRecords: null },
    last7Days: { inputBytes: 8192, inputRecords: 40 },
  };

  const SAMPLE_CONTAINERS_TODAY = [
    { containerName: "hive-web", inputBytes: 2048, inputRecords: 8 },
  ];

  it("shows ingest buckets and containers today on an unreachable outcome", async () => {
    await renderWithFetch(
      fetchResponse({
        outcome: "unreachable",
        reasonCode: "TIMEOUT",
        cached: false,
        ingest: SAMPLE_INGEST,
        containersToday: SAMPLE_CONTAINERS_TODAY,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/couldn't reach the swarm just now/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId("ingest-buckets")).toBeInTheDocument();
    expect(screen.getByText("Ingested Volume")).toBeInTheDocument();
    expect(screen.getByTestId("ingest-today-bytes")).toHaveTextContent("4 KB");
    expect(screen.getByTestId("ingest-today-records")).toHaveTextContent("12");
    expect(screen.getByTestId("ingest-yesterday-bytes")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("ingest-yesterday-records")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("ingest-yesterday-bytes")).not.toHaveTextContent("0");
    expect(screen.getByTestId("containers-today")).toBeInTheDocument();
    expect(screen.getByText("hive-web")).toBeInTheDocument();
    expect(screen.queryByTestId("fluentbit-counters")).not.toBeInTheDocument();
  });

  it("shows ingest buckets on a failed outcome", async () => {
    await renderWithFetch(
      fetchResponse({
        outcome: "failed",
        reasonCode: "AUTH_FAILED",
        cached: false,
        ingest: SAMPLE_INGEST,
        containersToday: SAMPLE_CONTAINERS_TODAY,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/swarm authentication failed/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId("ingest-buckets")).toBeInTheDocument();
    expect(screen.getByTestId("containers-today")).toBeInTheDocument();
  });

  it("does not render the ingest section when ingest is null", async () => {
    await renderWithFetch(
      fetchResponse({
        ...freshResponse(okReading()),
        ingest: null,
        containersToday: null,
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("fluentbit-status-badge")).toHaveTextContent("OK");
    });
    expect(screen.queryByTestId("ingest-buckets")).not.toBeInTheDocument();
    expect(screen.queryByTestId("containers-today")).not.toBeInTheDocument();
    expect(screen.queryByText("Ingested Volume")).not.toBeInTheDocument();
  });

  it("renders a null ingest day as unavailable, not 0", async () => {
    await renderWithFetch(
      fetchResponse({
        ...freshResponse(okReading({ uptimeSeconds: null })),
        ingest: {
          today: { inputBytes: 0, inputRecords: 0 },
          yesterday: { inputBytes: null, inputRecords: null },
          last7Days: { inputBytes: 100, inputRecords: 3 },
        },
        containersToday: [],
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("ingest-buckets")).toBeInTheDocument();
    });
    expect(screen.getByTestId("ingest-today-bytes")).toHaveTextContent("0 B");
    expect(screen.getByTestId("ingest-today-records")).toHaveTextContent("0");
    expect(screen.getByTestId("ingest-yesterday-bytes")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("ingest-yesterday-records")).toHaveTextContent("unavailable");
    expect(screen.getByTestId("ingest-yesterday-bytes")).not.toHaveTextContent(/^0/);
    expect(screen.getByTestId("counter-uptimeSeconds")).toHaveTextContent("unavailable");
  });
});
