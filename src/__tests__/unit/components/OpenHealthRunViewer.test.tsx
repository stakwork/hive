/**
 * @vitest-environment jsdom
 *
 * Unit tests for the run viewer's score block, by benchmark:
 * - a diagnosis run shows its weighted F1 and opens its problem list;
 * - a whole-patient summary shows its clinical F1, the findings it named
 *   and missed, its question, and opens the summary;
 * - a specialty summary shows leakage, and flags a task the paper's scorer
 *   cannot score; an absent specialty shows whether the summary abstained.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OpenHealthRunDetail } from "@/types/openhealth";

globalThis.React = React;

const mockArtifact = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: () => ({ workspace: { slug: "hive" } }) }));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/strut-run-graph", () => ({ StrutRunGraph: () => <div data-testid="run-graph" /> }));
vi.mock("@/components/openhealth/OpenHealthRunViewer/ImprovePanel", () => ({
  ImprovePanel: () => <div data-testid="improve-panel" />,
}));
vi.mock("@/components/openhealth/OpenHealthRunViewer/ArtifactPanel", () => ({
  ArtifactPanel: (props: { endpoint: string; kind: string }) => {
    mockArtifact(props);
    return <div data-testid="artifact-panel">{props.endpoint}</div>;
  },
}));

const { OpenHealthRunViewer } = await import("@/components/openhealth/OpenHealthRunViewer");

const ENDPOINT = "/api/workspaces/hive/openhealth/benchmarks/runs/run-1";

function detail(overrides: Partial<OpenHealthRunDetail> = {}): OpenHealthRunDetail {
  return {
    id: "run-1",
    strutRunId: "1790614605308",
    status: "SUCCESS",
    outcome: "succeeded",
    gtId: 7532,
    patientId: 2201,
    difficulty: "hard",
    task: "patient_diagnosis",
    variant: null,
    specialty: null,
    scores: {
      f1: 0.82,
      metric: "weighted_problem_list_f1_neutral",
      official: null,
      contested: 0,
      recall: 1,
      precision: 0.7,
      tier: "A",
      nMatched: 7,
      nGt: 7,
      nPred: 10,
    },
    costUsd: 1.57,
    durationMs: 1_569_998,
    error: null,
    createdAt: "2026-09-28T16:56:45.000Z",
    settledAt: "2026-09-28T17:22:55.000Z",
    title: "patient_diagnosis gt 7532 patient 2201",
    namespace: "oh-public-p2201",
    clinicalQuestion: null,
    contested: [],
    contestsRejected: [],
    matched: [{ pred: "N179", gt: "N179" }],
    missed: ["I10"],
    extra: ["E876"],
    found: [],
    summaryWords: null,
    criticalCount: null,
    metrics: {},
    chart: {
      chartChars: 41000,
      sectionCount: 37,
      sectionsIngested: 36,
      sectionsFailed: [],
      encounterCount: 3,
      withheldSections: ["assessment", "plan"],
    },
    ingested: [],
    produceCost: 1.5,
    produceSteps: 61,
    spreadsheetUrl: null,
    ...overrides,
  };
}

const SUMMARY = detail({
  gtId: 8274,
  patientId: 1675,
  task: "context_summarization",
  variant: "unconditioned",
  title: "context_summarization gt 8274 patient 1675",
  clinicalQuestion: "What is the current active problem list and clinical trajectory for this patient?",
  scores: {
    f1: 0.7,
    metric: "clinical_f1",
    official: null,
    contested: 0,
    recall: null,
    precision: null,
    tier: "A",
    nMatched: 7,
    nGt: 10,
    nPred: null,
  },
  matched: [],
  missed: ["Uterine artery Doppler high resistance flow", "Severe hypertension", "Gestational age 34 weeks"],
  extra: [],
  found: [
    "Hypertension",
    "Proteinuria",
    "Headache",
    "Gestational age",
    "Severe headache",
    "Upper abdominal pain",
    "Primigravida",
  ],
  summaryWords: 142,
  metrics: { clinical_f1: 0.7, omission_rate: 0.3, mean_summary_words: 142 },
});

const fetchMock = vi.fn();

function serve(run: OpenHealthRunDetail) {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(run), { status: 200 })));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenHealthRunViewer", () => {
  it("shows a diagnosis run's weighted F1 and opens its problem list", async () => {
    serve(detail());
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-viewer")).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, { cache: "no-store" });
    expect(screen.getByTestId("openhealth-run-scores").textContent).toContain("Weighted F1");
    expect(screen.getByTestId("openhealth-run-matched").textContent).toContain("N179");
    expect(screen.getByTestId("openhealth-run-extra").textContent).toContain("E876");
    expect(screen.queryByTestId("openhealth-run-found")).toBeNull();
    expect(screen.queryByTestId("openhealth-benchmark")).toBeNull();

    fireEvent.click(screen.getByTestId("openhealth-run-problem-list-pill"));
    await waitFor(() => expect(screen.getByTestId("artifact-panel")).toBeTruthy());
    expect(mockArtifact).toHaveBeenCalledWith({ endpoint: `${ENDPOINT}/artifacts/problem-list`, kind: "problem-list" });
    expect(screen.queryByTestId("openhealth-run-summary-pill")).toBeNull();
  });

  it("shows a summary's clinical F1, the findings it named and missed, its question, and opens the summary", async () => {
    serve(SUMMARY);
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-viewer")).toBeTruthy());

    expect(screen.getByTestId("openhealth-benchmark").textContent).toBe("Summary");
    expect(screen.getByTestId("openhealth-run-question").textContent).toContain("clinical trajectory");
    const scores = screen.getByTestId("openhealth-run-scores").textContent ?? "";
    expect(scores).toContain("Clinical F1");
    expect(scores).toContain("0.70");
    expect(scores).toContain("7 / 10");
    expect(scores).toContain("142");
    expect(screen.getByTestId("openhealth-run-found").textContent).toContain("Proteinuria");
    expect(screen.getByTestId("openhealth-run-missed").textContent).toContain("Severe hypertension");
    // A whole-patient summary is scored by recall alone: nothing leaks.
    expect(screen.queryByTestId("openhealth-run-extra")).toBeNull();
    expect(screen.queryByTestId("openhealth-run-matched")).toBeNull();

    fireEvent.click(screen.getByTestId("openhealth-run-summary-pill"));
    await waitFor(() => expect(screen.getByTestId("artifact-panel")).toBeTruthy());
    expect(mockArtifact).toHaveBeenCalledWith({ endpoint: `${ENDPOINT}/artifacts/summary`, kind: "summary" });
    expect(screen.queryByTestId("openhealth-run-problem-list-pill")).toBeNull();
  });

  it("shows a specialty summary's leakage, and flags a task the paper's scorer gives 0 regardless", async () => {
    serve({
      ...SUMMARY,
      variant: "specialty_conditioned",
      specialty: "Obstetrics_Gynecology",
      scores: { ...SUMMARY.scores!, metric: "conditioned_f1", f1: 0 },
      extra: ["Asthma"],
      criticalCount: 0,
    });
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-viewer")).toBeTruthy());

    expect(screen.getByTestId("openhealth-benchmark").textContent).toBe("Obstetrics/Gynecology summary");
    expect(screen.getByTestId("openhealth-run-scores").textContent).toContain("Conditioned F1");
    expect(screen.getByTestId("openhealth-run-extra").textContent).toContain("Asthma");
    expect(screen.getByTestId("openhealth-run-no-critical").textContent).toContain("no critical finding");
  });

  it("says whether an absent specialty's summary abstained", async () => {
    serve({
      ...SUMMARY,
      variant: "specialty_conditioned",
      specialty: "Cardiology",
      scores: { ...SUMMARY.scores!, metric: "abstention_accuracy", f1: 1, nMatched: 0, nGt: 0 },
      found: [],
      missed: [],
      extra: [],
      criticalCount: null,
      summaryWords: 9,
    });
    render(<OpenHealthRunViewer runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId("openhealth-run-viewer")).toBeTruthy());

    const scores = screen.getByTestId("openhealth-run-scores").textContent ?? "";
    expect(scores).toContain("Abstention");
    expect(scores).toContain("Yes");
    expect(screen.getByTestId("openhealth-run-abstention").textContent).toContain("said so");
    expect(screen.queryByTestId("openhealth-run-found")).toBeNull();
    expect(screen.queryByTestId("openhealth-run-no-critical")).toBeNull();
  });
});
