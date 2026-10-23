import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { mockNotifyCardJob } = vi.hoisted(() => ({ mockNotifyCardJob: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { workspace: { findUnique: async () => ({ sourceControlOrg: { githubLogin: "acme-gh" } }) } },
}));
vi.mock("@/lib/pusher", () => ({ notifyCanvasCardJob: mockNotifyCardJob }));

import {
  mockBrainstormAbout,
  mockCreateInitiative,
  mockInitiativeList,
  mockInitiativeTree,
  resetMockInitiativeStore,
  startMockBrainstorm,
  startMockInitiativeBuild,
} from "@/app/api/mock/graph/initiative-fixture";
import { initiativeStage } from "@/lib/initiative-plan";
import { scriptedJamieReply } from "@/app/api/mock/anthropic/v1/messages/jamie-script";
import { resetMockBrainstormStore, mockChoiceTreeWithWrites } from "@/app/api/mock/graph/brainstorm-store";
import { mockCanvasJobs, resetMockCanvasJobs } from "@/app/api/mock/graph/canvas-jobs";
import { MOCK_STRUT_JOBS } from "@/app/api/mock/graph/strut-artifacts";

const scope = (name: string, ref: string, selected = "") =>
  `<canvas-scope>\nThe user is on the infinite canvas, on initiative "${name}" (\`${ref}\`) in workspace \`ws\`.${selected}\n</canvas-scope>`;
const turn = (said: string, scopeText: string) => [
  { role: "user", content: said },
  { role: "user", content: scopeText },
];

beforeEach(() => {
  resetMockInitiativeStore();
  resetMockBrainstormStore();
  resetMockCanvasJobs();
  mockNotifyCardJob.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("the fixture", () => {
  test("seven initiatives, most recently updated first, each read back as its own tree", () => {
    const list = mockInitiativeList();
    expect(list.map((i) => i.name)).toEqual([
      "Self-serve onboarding",
      "Janitor insights v2",
      "Voice-first planning",
      "Usage-based billing",
      "Mobile review app",
      "SOC 2 Type II",
      "Janitor marketplace",
    ]);
    expect(list.every((i, k) => k === 0 || (list[k - 1].updated_at ?? 0) >= (i.updated_at ?? 0))).toBe(true);
    expect(initiativeStage(mockInitiativeTree("mock-initiative-mobile").nodes)).toMatchObject({
      milestones: 0,
      features: 0,
    });
    const onboarding = mockInitiativeTree("mock-initiative-onboarding");
    expect(onboarding.nodes.find((n) => n.ref_id === "mock-m-signup")?.brainstorms).toEqual([
      "mock-brainstorm-auth",
      "mock-brainstorm-repo",
    ]);
  });
});

describe("the fake initiative-build job", () => {
  test("writes milestones, then stories with proposed requirements scheduled into them, then features, a node at a time", () => {
    expect(startMockInitiativeBuild("mock-initiative-mobile")).toBe(true);
    expect(mockInitiativeTree("mock-initiative-mobile").building).toBe(true);
    expect(startMockInitiativeBuild("mock-initiative-mobile")).toBe(false);
    vi.advanceTimersByTime(700);
    expect(mockInitiativeTree("mock-initiative-mobile").nodes.map((n) => n.type)).toEqual([
      "HiveInitiative",
      "Brief",
      "HiveMilestone",
    ]);
    vi.runAllTimers();
    const tree = mockInitiativeTree("mock-initiative-mobile");
    expect(tree.building).toBe(false);
    const stage = initiativeStage(tree.nodes);
    expect(stage).toMatchObject({ milestones: 2, features: 3, stories: 2, requirements: 4 });
    expect(stage.unaccepted).toBe(stage.requirements);
    const req = tree.nodes.find((n) => n.type === "Requirement")!;
    expect(req.properties).toMatchObject({ status: "proposed", created_by: "strut", created_by_kind: "strut" });
    expect(String(req.properties.requirement_id)).toMatch(/^[0-9a-f-]{36}$/);
    // Stories hang off the initiative.
    const story = tree.nodes.find((n) => n.type === "UserStory")!;
    expect(tree.edges).toContainEqual({ source: "mock-initiative-mobile", target: story.ref_id, type: "HAS_STORY" });
  });

  test("leaves what's planned alone and fills the gaps", () => {
    expect(startMockInitiativeBuild("mock-initiative-onboarding")).toBe(false);
    startMockInitiativeBuild("mock-initiative-billing");
    vi.runAllTimers();
    const tree = mockInitiativeTree("mock-initiative-billing");
    expect(initiativeStage(tree.nodes)).toMatchObject({ milestones: 1, stories: 2 });
    expect(initiativeStage(tree.nodes).features).toBeGreaterThan(0);
  });
});

describe("scripted Jamie", () => {
  test("nothing without the scope block: titles and follow-ups never start a job", () => {
    expect(scriptedJamieReply([{ role: "user", content: "Create an initiative: Something" }])).toBeNull();
  });

  test("creates an initiative with its brief", () => {
    const reply = scriptedJamieReply(
      turn(
        "Create an initiative: Customer health scores because CSMs hear about churn too late",
        "<canvas-scope>\nOn the canvas.\n</canvas-scope>",
      ),
    );
    expect(reply).toContain("**Customer health scores**");
    const created = mockInitiativeList()[0];
    expect(created.name).toBe("Customer health scores");
    expect(mockInitiativeTree(created.ref_id).nodes.find((n) => n.type === "Brief")?.properties.text).toBe(
      "CSMs hear about churn too late",
    );
  });

  test("builds out the initiative in view", () => {
    const reply = scriptedJamieReply(turn("Build it out please", scope("Mobile review app", "mock-initiative-mobile")));
    expect(reply).toContain("initiative-build");
    expect(mockInitiativeTree("mock-initiative-mobile").building).toBe(true);
  });

  test("brainstorms the selected card, linking the brainstorm to it", () => {
    const reply = scriptedJamieReply(
      turn(
        "Brainstorm this feature: Repo picker",
        scope(
          "Self-serve onboarding",
          "mock-initiative-onboarding",
          ' They have selected the InitiativeFeature "Repo picker" (`mock-f-repo`).',
        ),
      ),
    );
    expect(reply).toContain("How should we build Repo picker?");
    const feature = mockInitiativeTree("mock-initiative-onboarding").nodes.find((n) => n.ref_id === "mock-f-repo");
    expect(feature?.brainstorms).toEqual([expect.stringMatching(/^mock-bs-/)]);
    const root = feature!.brainstorms![0];
    expect(mockChoiceTreeWithWrites(root, ["Question"]).nodes[0].properties.text).toBe(
      "How should we build Repo picker?",
    );
    expect(mockBrainstormAbout(root)).toBe("mock-f-repo");
  });

  test("brainstorms the initiative when nothing is selected, and says what's next from the graph", () => {
    expect(scriptedJamieReply(turn("brainstorm", scope("Voice-first planning", "mock-initiative-voice")))).toContain(
      "How should we stage Voice-first planning?",
    );
    expect(mockInitiativeTree("mock-initiative-voice").nodes[0].brainstorms).toHaveLength(1);
    expect(scriptedJamieReply(turn("What's next?", scope("Voice-first planning", "mock-initiative-voice")))).toContain(
      "break it into milestones",
    );
    expect(
      scriptedJamieReply(turn("Where are we?", scope("Self-serve onboarding", "mock-initiative-onboarding"))),
    ).toContain("accept or drop the 4 proposed requirements");
  });

  test("a brainstorm's answers make the level below what it's about", () => {
    const root = startMockBrainstorm("mock-m-digest", "Weekly digest", "HiveMilestone");
    expect(
      mockInitiativeTree("mock-initiative-janitor").nodes.find((n) => n.ref_id === "mock-m-digest")?.brainstorms,
    ).toEqual([root]);
  });
});

/** The jobs Jamie started in the test, without the fixture's own build jobs. */
const asked = <T extends { jobId: string }>(jobs: T[]) =>
  jobs.filter((j) => !MOCK_STRUT_JOBS.some((m) => m.jobId === j.jobId));

describe("the fake jobs on canvas cards", () => {
  test("a build-out is a job on the initiative's card: running as it writes, done with its plan", async () => {
    scriptedJamieReply(turn("Build it out please", scope("Mobile review app", "mock-initiative-mobile")));
    expect(mockCanvasJobs("mock-initiative-mobile").jobs).toEqual([
      expect.objectContaining({
        title: "Build out Mobile review app",
        state: "running",
        refId: "mock-initiative-mobile",
      }),
    ]);
    await vi.runAllTimersAsync();
    const read = mockCanvasJobs("mock-initiative-mobile");
    expect(read.jobs[0].state).toBe("done");
    expect(read.artifactsByRef["mock-initiative-mobile"]).toEqual([
      expect.objectContaining({ kind: "markdown", title: "Plan for Mobile review app" }),
    ]);
    const nudges = mockNotifyCardJob.mock.calls.map(([login, n]) => [
      login,
      n.state,
      n.initiativeRefId,
      n.workspaceSlug,
    ]);
    expect(nudges[0]).toEqual(["acme-gh", "running", "mock-initiative-mobile", "ws"]);
    expect(nudges.at(-1)).toEqual(["acme-gh", "done", "mock-initiative-mobile", "ws"]);
    expect(nudges.length).toBeGreaterThan(2);
  });

  test("a feature brainstorm is a job on the feature's card", async () => {
    scriptedJamieReply(
      turn(
        "Brainstorm this feature",
        scope(
          "Self-serve onboarding",
          "mock-initiative-onboarding",
          ' They have selected the InitiativeFeature "Repo picker" (`mock-f-repo`).',
        ),
      ),
    );
    await vi.runAllTimersAsync();
    const read = mockCanvasJobs("mock-initiative-onboarding");
    expect(asked(read.jobs)).toEqual([expect.objectContaining({ state: "done", refId: "mock-f-repo" })]);
    expect(read.artifactsByRef["mock-f-repo"].filter((a) => a.kind === "markdown")).toHaveLength(1);
    expect(mockCanvasJobs("mock-initiative-mobile").jobs).toEqual([]);
  });

  test("nothing to build makes no job", () => {
    scriptedJamieReply(turn("Build it out please", scope("Self-serve onboarding", "mock-initiative-onboarding")));
    expect(asked(mockCanvasJobs("mock-initiative-onboarding").jobs)).toEqual([]);
  });

  test("the mock strut jobs are on their cards, with strut's run.end entries for the reader to map", () => {
    const read = mockCanvasJobs("mock-initiative-onboarding", (e) =>
      e.map((a) => ({
        id: a.id,
        kind: "markdown" as const,
        title: a.title,
        source: { type: "inline" as const, content: {} },
      })),
    );
    expect(read.jobs.find((j) => j.refId === "mock-f-gh")).toMatchObject({ title: "Implement GitHub sign-in" });
    expect(read.artifactsByRef["mock-f-gh"].map((a) => a.id)).toContain("pr-hive-5601");
  });

  test("Implement on a feature is a job that returns a pull request", async () => {
    scriptedJamieReply(
      turn(
        "Implement this feature.",
        scope(
          "Self-serve onboarding",
          "mock-initiative-onboarding",
          ' They have selected the InitiativeFeature "Workspace naming" (`mock-f-name`).',
        ),
      ),
    );
    expect(asked(mockCanvasJobs("mock-initiative-onboarding").jobs)).toEqual([
      expect.objectContaining({ title: "Implement Workspace naming", state: "running", refId: "mock-f-name" }),
    ]);
    await vi.runAllTimersAsync();
    const read = mockCanvasJobs("mock-initiative-onboarding");
    expect(asked(read.jobs)[0].state).toBe("done");
    expect(read.artifactsByRef["mock-f-name"]).toEqual([
      expect.objectContaining({ kind: "pull_request", title: "Workspace naming" }),
    ]);
  });
});
