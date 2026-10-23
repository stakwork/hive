import { describe, expect, it, vi } from "vitest";

// job-turn's server neighbours, not under test here.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pusher", () => ({ notifyCanvasConversationUpdated: vi.fn(), notifyCanvasCardJob: vi.fn() }));
vi.mock("@/services/strut-orchestrator-wake", () => ({ invokeOrchestratorOnJobTurn: vi.fn() }));
vi.mock("@/services/strut-runs", () => ({ labForRow: vi.fn() }));

import { MOCK_STRUT_JOBS, MOCK_STRUT_SWARM_ID, mockStrutFile } from "@/app/api/mock/graph/strut-artifacts";
import { parseArtifactContent, type ArtifactKind } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { parseStrutArtifactKey } from "@/lib/strut-jobs";
import { mapStrutArtifacts, parseStrutArtifacts } from "@/services/strut-runs/job-turn";

const all = MOCK_STRUT_JOBS.flatMap((j) => j.artifacts);

describe("the mock strut jobs' run.end artifacts", () => {
  it("are whole entries, as strut's list parses them", () => {
    for (const job of MOCK_STRUT_JOBS) expect(parseStrutArtifacts(job.artifacts)).toHaveLength(job.artifacts.length);
  });

  it("map to refs with nothing dropped but the one strut reported as failed", () => {
    const dropped = MOCK_STRUT_JOBS.flatMap((j) => mapStrutArtifacts(j.artifacts, MOCK_STRUT_SWARM_ID).dropped);
    expect(dropped).toEqual([{ title: "Settings page", reason: "screenshot failed: page did not load" }]);
  });

  it("cover every kind the canvas shows, and their inline content reads", () => {
    const refs = MOCK_STRUT_JOBS.flatMap((j) => mapStrutArtifacts(j.artifacts, MOCK_STRUT_SWARM_ID).refs);
    const kinds = new Set(refs.map((r) => r.kind));
    for (const k of [
      "image",
      "walkthrough",
      "pull_request",
      "markdown",
      "html",
      "code",
      "log",
      "json",
      "url",
      "pdf",
    ] as ArtifactKind[])
      expect(kinds.has(k), k).toBe(true);
    for (const r of refs)
      if (r.source.type === "inline") expect(parseArtifactContent(r.kind, r.source.content), r.id).not.toBeNull();
      else expect(r.source).toMatchObject({ type: "graph", swarmId: MOCK_STRUT_SWARM_ID });
    // Pull requests across two repos, in each state.
    const prs = refs.filter((r) => r.kind === "pull_request");
    const states = prs.map((r) => (r.source.type === "inline" ? r.source.content.state : null));
    expect(new Set(states)).toEqual(new Set(["open", "draft", "merged"]));
    expect(new Set(prs.map((r) => (r.source.type === "inline" ? r.source.content.repo : null))).size).toBe(2);
  });

  it("name files the reader serves under mocks, and nothing else", async () => {
    for (const a of all) {
      if (!a.url?.startsWith("/jobs/")) continue;
      const key = parseStrutArtifactKey(a.url);
      expect(key, a.url).not.toBeNull();
      expect(await mockStrutFile(key!.path), a.url).not.toBeNull();
    }
    const frames = JSON.parse(String((await mockStrutFile("walkthrough.json"))!.body)) as {
      frames: { file: string }[];
    };
    for (const f of frames.frames) expect(await mockStrutFile(f.file), f.file).not.toBeNull();
    expect(await mockStrutFile("../package.json")).toBeNull();
    expect(await mockStrutFile("sub/onboarding-step-1.png")).toBeNull();
    expect(await mockStrutFile("constructor")).toBeNull();
  });
});
