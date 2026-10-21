/**
 * Mock mode (`USE_MOCKS`): the org's initiatives in the graph, for the
 * infinite canvas, in the plan's problem-before-solution shape (Jarvis
 * 133–135): seven initiatives as the canvas prototype drew them, from fully
 * planned (stories, scheduled requirements, milestones, features with an
 * architecture and build jobs that returned pull requests, brainstorms on a
 * milestone) to a
 * brief only. Saves from the canvas (`saveInitiativeChanges`) and the fake
 * strut jobs below land in an in-memory store overlaid on them, kept on
 * `globalThis` so a dev-server reload doesn't drop it.
 *
 * The fake jobs stand in for strut's `initiative-build` and `brainstorm`
 * workflows: they write the same node types a few at a time, so cards appear
 * on the canvas as they are written.
 */

import type { SavePlan } from "@/services/graph/brainstorm-write";
import type { InitiativePlan } from "@/services/graph/initiative-write";
import type {
  InitiativeNodeType,
  InitiativeSummary,
  InitiativeTreeType,
  InitiativeTreeData,
  InitiativeTreeNode,
} from "@/services/graph/workbench";
import { mockBrainstormWrite } from "./brainstorm-store";

type Tree = Pick<InitiativeTreeData, "nodes" | "edges">;

interface Store {
  nodes: Map<string, InitiativeTreeNode>;
  edges: InitiativeTreeData["edges"];
  patches: Map<string, Record<string, unknown>>;
  /** Initiatives created by saves or jobs, newest first. */
  roots: string[];
  /** Brainstorms started about a node: its ref_id → root question ref_ids. */
  brainstorms: Map<string, string[]>;
  /** Requirements rescheduled by saves: ref_id → the milestone that INCLUDES it, or null for the backlog. */
  scheduled: Map<string, string | null>;
  /** Nodes a choice made: ref_id → the options (`Option -RESULTED_IN->`). */
  madeBy: Map<string, string[]>;
  /** Initiatives a fake build job is writing to right now. */
  building: Set<string>;
  seq: number;
}

const holder = globalThis as unknown as { __mockInitiativeStoreV3?: Store };
const store = (): Store =>
  (holder.__mockInitiativeStoreV3 ??= {
    nodes: new Map(),
    edges: [],
    patches: new Map(),
    roots: [],
    brainstorms: new Map(),
    scheduled: new Map(),
    madeBy: new Map(),
    building: new Set(),
    seq: 0,
  });

export function resetMockInitiativeStore() {
  delete holder.__mockInitiativeStoreV3;
}

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * The plan as the canvas prototype drew it (problem before solution): each
 * initiative's brief and user stories with their requirements, its milestones
 * in order (each scheduling requirements by `INCLUDES`), and under a
 * milestone its features with their architecture and their build jobs
 * (read through `mockCanvasJobs`, not the graph). Ids are the prototype's, prefixed `mock-`.
 */
interface Spec {
  id: string;
  name: string;
  updatedDaysAgo: number;
  by: "human" | "strut";
  brief?: string;
  milestones?: Array<{ id: string; name: string; by?: "human" | "strut"; brainstorms?: string[] }>;
  stories?: Array<{
    id: string;
    text: string;
    by?: "human" | "strut";
    /** [id, text, status, milestone id (scheduled) or undefined (backlog), by]. */
    reqs: Array<[string, string, string, string?, ("human" | "strut")?]>;
  }>;
  features?: Array<{
    id: string;
    milestone: string;
    name: string;
    by?: "human" | "strut";
    status?: string;
    /** The brainstorm option whose choice made it. */
    madeBy?: string;
    architecture?: { name: string; description: string; diagram?: string };
    /** Its strut jobs (the build), each with the pull requests it returned. */
    jobs?: MockBuildJob[];
    brainstorms?: string[];
  }>;
  brainstorms?: string[];
}

export const MOCK_INITIATIVES: Spec[] = [
  {
    id: "mock-initiative-onboarding",
    name: "Self-serve onboarding",
    updatedDaysAgo: 0,
    by: "human",
    brief: "New teams get from GitHub sign-in to a first janitor run in under ten minutes, without talking to us.",
    milestones: [
      {
        id: "mock-m-signup",
        name: "Sign-up to first workspace",
        by: "human",
        brainstorms: ["mock-brainstorm-auth", "mock-brainstorm-repo"],
      },
      { id: "mock-m-invite", name: "Invite the team" },
      { id: "mock-m-janitor", name: "First janitor run" },
    ],
    stories: [
      {
        id: "mock-s-gh-1",
        text: "As a new PM, I sign in with GitHub and land in a fresh workspace",
        reqs: [
          ["mock-r-1", "Sign-in completes in one redirect", "accepted", "mock-m-signup"],
          ["mock-r-2", "Returning users skip workspace creation", "accepted", "mock-m-signup"],
          ["mock-r-3", "Show which GitHub scopes we ask for, and why", "proposed", "mock-m-signup"],
          ["mock-r-14", "Orgs that enforce SSO can sign up", "proposed"],
        ],
      },
      {
        id: "mock-s-gh-2",
        text: "As an admin, I see who signed up from my org",
        by: "human",
        reqs: [
          ["mock-r-4", "Org admins get a weekly sign-up digest", "dropped", "mock-m-signup"],
          ["mock-r-5", "Show the GitHub avatar next to each name", "accepted", "mock-m-signup", "human"],
        ],
      },
      {
        id: "mock-s-repo-1",
        text: "As a new PM, I pick which repos Hive watches",
        by: "human",
        reqs: [
          ["mock-r-6", "List repos the GitHub App can see, newest first", "proposed", "mock-m-signup"],
          ["mock-r-7", "Search by name as you type", "proposed", "mock-m-signup"],
        ],
      },
      {
        id: "mock-s-name",
        text: "As a new PM, I name my workspace",
        by: "human",
        reqs: [["mock-r-13", "A name is suggested from the GitHub org", "accepted", "mock-m-signup", "human"]],
      },
      {
        id: "mock-s-link-1",
        text: "As an owner, I share one link to invite my team",
        reqs: [
          ["mock-r-9", "Links expire after seven days", "accepted", "mock-m-invite"],
          ["mock-r-10", "Invitees land on the workspace they were invited to", "accepted", "mock-m-invite"],
          ["mock-r-15", "Invite by email as well as by link", "accepted", undefined, "human"],
        ],
      },
    ],
    features: [
      {
        id: "mock-f-gh",
        milestone: "mock-m-signup",
        name: "GitHub sign-in",
        madeBy: "mock-brainstorm-auth-app",
        architecture: {
          name: "GitHub App per org",
          description:
            "A GitHub App installed per org. Sign-in is OAuth through the app; the installation token is stored encrypted and refreshed on use.",
          diagram:
            "graph LR; A[Sign in] --> B[GitHub consent]; B --> C[Install app]; C --> D[Pick org]; D --> E[Fresh workspace]; C --> F[Owner approves]; F --> D",
        },
        jobs: [
          {
            title: "Implement GitHub sign-in",
            state: "done",
            prs: [
              ["stakwork/hive", 5601, "GitHub App install flow", "merged"],
              ["stakwork/hive", 5604, "Skip workspace creation for returning users", "merged"],
              ["stakwork/stakgraph", 412, "Read installation tokens per org", "merged"],
            ],
          },
        ],
      },
      {
        id: "mock-f-repo",
        milestone: "mock-m-signup",
        name: "Repo picker",
        madeBy: "mock-brainstorm-repo-picker",
        architecture: {
          name: "Cached installation repos",
          description:
            "Reads the installation's repos from the GitHub API and lists them newest first; search filters the loaded list.",
        },
        jobs: [
          {
            title: "Implement Repo picker",
            state: "running",
            prs: [
              ["stakwork/hive", 5622, "List installation repos, newest first", "open"],
              ["stakwork/hive", 5630, "Search repos as you type", "draft"],
            ],
          },
        ],
      },
      { id: "mock-f-name", milestone: "mock-m-signup", name: "Workspace naming", by: "human" },
      {
        id: "mock-f-link",
        milestone: "mock-m-invite",
        name: "Invite by link",
        jobs: [
          {
            title: "Implement Invite by link",
            state: "done",
            prs: [["stakwork/hive", 5640, "Invite links that expire", "open", ["unit-tests"]]],
          },
        ],
      },
    ],
  },
  {
    id: "mock-initiative-janitor",
    name: "Janitor insights v2",
    updatedDaysAgo: 1,
    by: "strut",
    brief: "PMs see which janitor findings matter this week, ranked by blast radius, not by count.",
    milestones: [{ id: "mock-m-digest", name: "Weekly digest" }],
    stories: [
      {
        id: "mock-s-rank-1",
        text: "As a PM, I see the riskiest finding first",
        reqs: [
          ["mock-r-11", "Rank uses files touched in the last 30 days", "accepted", "mock-m-digest"],
          ["mock-r-12", "Explain the rank in one line", "accepted", "mock-m-digest"],
        ],
      },
    ],
    features: [
      {
        id: "mock-f-rank",
        milestone: "mock-m-digest",
        name: "Rank by blast radius",
        jobs: [
          {
            title: "Implement Rank by blast radius",
            state: "done",
            prs: [["stakwork/hive", 5590, "Rank findings by blast radius", "merged"]],
          },
        ],
      },
      {
        id: "mock-f-mute",
        milestone: "mock-m-digest",
        name: "Mute a finding",
        by: "human",
        architecture: {
          name: "Muted findings per workspace",
          description: "A muted finding is hidden from the digest.",
        },
        jobs: [
          {
            title: "Implement Mute a finding",
            state: "failed",
            error: "The pod ran out of disk while installing dependencies",
            prs: [],
          },
        ],
      },
    ],
  },
  {
    id: "mock-initiative-voice",
    name: "Voice-first planning",
    updatedDaysAgo: 3,
    by: "human",
    brief: "Plan out loud: say what you want and watch the plan grow, hands free.",
  },
  {
    id: "mock-initiative-billing",
    name: "Usage-based billing",
    updatedDaysAgo: 14,
    by: "human",
    brief: "Charge by janitor runs, not seats, so small teams can start free.",
    milestones: [{ id: "mock-m-meter", name: "Meter janitor runs" }],
  },
  {
    id: "mock-initiative-mobile",
    name: "Mobile review app",
    updatedDaysAgo: 22,
    by: "human",
    brief: "Approve or bounce a task's PR from your phone in under a minute.",
  },
  {
    id: "mock-initiative-soc2",
    name: "SOC 2 Type II",
    updatedDaysAgo: 49,
    by: "strut",
    brief: "Pass the SOC 2 Type II audit so enterprise deals stop stalling at security review.",
  },
  { id: "mock-initiative-market", name: "Janitor marketplace", updatedDaysAgo: 68, by: "strut" },
];

function fixtureTree(spec: Spec): Tree {
  const nodes: InitiativeTreeNode[] = [];
  const edges: InitiativeTreeData["edges"] = [];
  const updated = daysAgo(spec.updatedDaysAgo);
  const created = daysAgo(spec.updatedDaysAgo + 20);
  const add = (
    type: InitiativeTreeType,
    id: string,
    props: Record<string, unknown>,
    by: "human" | "strut" = spec.by,
    parent?: [string, string],
    extra: Partial<InitiativeTreeNode> = {},
  ) => {
    nodes.push({
      ref_id: id,
      type,
      properties: {
        created_at: created,
        updated_at: updated,
        created_by: by === "human" ? "dev-user" : "strut",
        created_by_kind: by,
        ...props,
      },
      ...extra,
    });
    if (parent) edges.push({ source: parent[0], target: id, type: parent[1] });
  };
  add(
    "HiveInitiative",
    spec.id,
    { initiative_id: spec.id, name: spec.name, status: "ACTIVE" },
    spec.by,
    undefined,
    spec.brainstorms ? { brainstorms: spec.brainstorms } : {},
  );
  if (spec.brief)
    add("Brief", `${spec.id}-brief`, { brief_id: `${spec.id}-brief`, text: spec.brief }, spec.by, [
      spec.id,
      "HAS_BRIEF",
    ]);
  for (const st of spec.stories ?? []) {
    add("UserStory", st.id, { story_id: st.id, text: st.text, status: "accepted" }, st.by ?? "strut", [
      spec.id,
      "HAS_STORY",
    ]);
    for (const [id, text, status, milestone, by] of st.reqs)
      add(
        "Requirement",
        id,
        { requirement_id: id, text, status },
        by ?? "strut",
        [st.id, "HAS_REQUIREMENT"],
        milestone ? { scheduled: [milestone] } : {},
      );
  }
  spec.milestones?.forEach((m, i) =>
    add(
      "HiveMilestone",
      m.id,
      { milestone_id: m.id, name: m.name, sequence: i + 1 },
      m.by ?? "strut",
      [spec.id, "HAS_MILESTONE"],
      m.brainstorms ? { brainstorms: m.brainstorms } : {},
    ),
  );
  for (const f of spec.features ?? []) {
    add(
      "InitiativeFeature",
      f.id,
      { feature_id: f.id, name: f.name, status: f.status ?? "accepted" },
      f.by ?? "strut",
      [f.milestone, "HAS_FEATURE"],
      { ...(f.madeBy ? { madeBy: [f.madeBy] } : {}), ...(f.brainstorms ? { brainstorms: f.brainstorms } : {}) },
    );
    if (f.architecture)
      add("Architecture", `${f.id}-arch`, { architecture_id: `${f.id}-arch`, ...f.architecture }, "strut", [
        f.id,
        "HAS_ARCHITECTURE",
      ]);
  }
  return { nodes, edges };
}

/** A feature's fake strut job: [repo, number, title, state, failing checks] per pull request it returned. */
export interface MockBuildJob {
  title: string;
  state: "running" | "done" | "failed";
  error?: string;
  prs: Array<[string, number, string, "open" | "draft" | "merged" | "closed", string[]?]>;
}

/** The fixture's build jobs, by feature, for an initiative. */
export function mockBuildJobs(initiativeRefId: string): Array<{ refId: string; job: MockBuildJob }> {
  const spec = MOCK_INITIATIVES.find((i) => i.id === initiativeRefId);
  return (spec?.features ?? []).flatMap((f) => (f.jobs ?? []).map((job) => ({ refId: f.id, job })));
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** The fixture (or a saved initiative) with the store's saves overlaid, reachable from `refId`. */
export function mockInitiativeTree(refId: string): Tree & { building: boolean } {
  const s = store();
  const spec = MOCK_INITIATIVES.find((i) => i.id === refId);
  const base = spec ? fixtureTree(spec) : { nodes: [], edges: [] };
  const nodes = new Map<string, InitiativeTreeNode>(
    base.nodes.map((n) => [n.ref_id, { ...n, properties: { ...n.properties, ...s.patches.get(n.ref_id) } }]),
  );
  for (const [id, n] of s.nodes) nodes.set(id, { ...n, properties: { ...n.properties } });
  for (const [id, roots] of s.brainstorms) {
    const n = nodes.get(id);
    if (n) nodes.set(id, { ...n, brainstorms: [...(n.brainstorms ?? []), ...roots] });
  }
  for (const [id, milestone] of s.scheduled) {
    const n = nodes.get(id);
    if (n) nodes.set(id, { ...n, scheduled: milestone ? [milestone] : undefined });
  }
  for (const [id, options] of s.madeBy) {
    const n = nodes.get(id);
    if (n) nodes.set(id, { ...n, madeBy: [...(n.madeBy ?? []), ...options] });
  }
  const edges = [...base.edges, ...s.edges];
  const keep = new Set<string>();
  for (const stack = [refId]; stack.length; ) {
    const id = stack.pop()!;
    // A deleted node hides everything under it, as the graph read does.
    if (keep.has(id) || !nodes.has(id) || nodes.get(id)!.properties.deleted_at != null) continue;
    keep.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return {
    nodes: [...nodes.values()].filter((n) => keep.has(n.ref_id)),
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    building: s.building.has(refId),
  };
}

/** Every initiative, most recently updated first: ones created this session, then the fixtures. */
export function mockInitiativeList(): InitiativeSummary[] {
  const s = store();
  const summary = (id: string): InitiativeSummary[] => {
    const n = mockInitiativeTree(id).nodes.find((x) => x.ref_id === id);
    if (!n) return [];
    const p = n.properties;
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
    const when = (k: string) => (str(k) ? Date.parse(str(k)!) : null);
    return [
      {
        ref_id: id,
        name: str("name") ?? id,
        status: str("status"),
        created_at: when("created_at"),
        updated_at: when("updated_at"),
        created_by: str("created_by"),
        created_by_kind: str("created_by_kind"),
        assignee_id: str("assignee_id"),
      },
    ];
  };
  return [...s.roots, ...MOCK_INITIATIVES.map((i) => i.id)]
    .flatMap(summary)
    .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

export function mockInitiativesBuilding(): boolean {
  return store().building.size > 0;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Applies a save plan to the store; returns the ref_id each new card got. */
export function mockInitiativeWrite(root: string | null, plan: InitiativePlan): Record<string, string> {
  const s = store();
  const created: Record<string, string> = {};
  const idOf = (e: { ref: string } | { temp: string }) => ("ref" in e ? e.ref : created[e.temp]);
  for (const c of plan.creates) {
    const id = `mock-plan-${++s.seq}`;
    created[c.temp] = id;
    s.nodes.set(id, { ref_id: id, type: c.nodeType, properties: { ...c.data } });
    if (c.nodeType === "HiveInitiative" && root === null) s.roots.unshift(id);
    if (c.parent && c.edgeType) s.edges.push({ source: idOf(c.parent), target: id, type: c.edgeType });
  }
  for (const [id, data] of Object.entries(plan.patches)) {
    const own = s.nodes.get(id);
    if (own) own.properties = { ...own.properties, ...data };
    else s.patches.set(id, { ...s.patches.get(id), ...data });
  }
  for (const sc of plan.schedules) s.scheduled.set(idOf(sc.requirement), sc.milestone);
  // RESULTED_IN is what a node reads back as `madeBy`; SATISFIES isn't read.
  for (const l of plan.links)
    if (l.edgeType === "RESULTED_IN") {
      const target = idOf(l.target);
      s.madeBy.set(target, [...(s.madeBy.get(target) ?? []), idOf(l.source)]);
    }
  return created;
}

const KEYS: Record<InitiativeNodeType, string> = {
  HiveInitiative: "initiative_id",
  HiveMilestone: "milestone_id",
  Brief: "brief_id",
  InitiativeFeature: "feature_id",
  UserStory: "story_id",
  Requirement: "requirement_id",
};

/** One node written as strut would, linked under `parent`. */
function strutWrite(type: InitiativeNodeType, props: Record<string, unknown>, parent?: { id: string; edge: string }) {
  const s = store();
  const id = `mock-plan-${++s.seq}`;
  const at = new Date().toISOString();
  s.nodes.set(id, {
    ref_id: id,
    type,
    properties: {
      [KEYS[type]]: crypto.randomUUID(),
      created_at: at,
      updated_at: at,
      created_by: "strut",
      created_by_kind: "strut",
      ...props,
    },
  });
  if (parent) s.edges.push({ source: parent.id, target: id, type: parent.edge });
  return id;
}

/** Creates an initiative as strut would (Jamie's "create an initiative"); returns its ref_id. */
export function mockCreateInitiative(name: string, why?: string): string {
  const id = strutWrite("HiveInitiative", { name, status: "DRAFT" });
  store().roots.unshift(id);
  if (why) strutWrite("Brief", { text: why }, { id, edge: "HAS_BRIEF" });
  return id;
}

const STEP_MS = 650;

interface PlanStep {
  milestone: string;
  story: string;
  reqs: string[];
  features: string[];
}

/** A canned plan to write, shaped by the initiative's name: per milestone, a journey, its requirements and the features. */
function planFor(name: string): PlanStep[] {
  const n = name.toLowerCase();
  if (n.includes("mobile"))
    return [
      {
        milestone: "Read on the go",
        story: "As a PM I can check a task's PR from my phone.",
        reqs: ["The PR loads in under two seconds on 4G", "The diff is readable on a phone"],
        features: ["PR viewer"],
      },
      {
        milestone: "Act on the go",
        story: "As a PM I can approve or bounce a PR from my phone.",
        reqs: ["Approve and bounce are one tap each", "Works offline and syncs later"],
        features: ["Approve and bounce", "Offline queue"],
      },
    ];
  return [
    {
      milestone: "Foundations",
      story: `As a user I can do the main thing ${name} is for.`,
      reqs: ["The flow has at most three steps", "Every step can be undone"],
      features: [`${name}: core flow`],
    },
    {
      milestone: "Launch",
      story: "As an admin I can turn it on for my org.",
      reqs: ["Off by default for existing orgs", "One switch to turn it on"],
      features: [`${name}: rollout`],
    },
  ];
}

/**
 * Fakes strut's `initiative-build` on one initiative, one node every
 * `STEP_MS`: a brief if it has none; then, if it has no user stories yet,
 * the journeys and their requirements (all `proposed`); milestones if it has
 * none, each scheduling its requirements (`INCLUDES`); and features under
 * every milestone that has none. False when there is nothing to write or a
 * build is already running. `progress` hears each write and the end (the
 * job's marker on the canvas, `canvas-jobs.ts`).
 */
export function startMockInitiativeBuild(
  root: string,
  progress?: { step: () => void; done: (written: number) => void },
): boolean {
  const s = store();
  if (s.building.has(root)) return false;
  const tree = mockInitiativeTree(root);
  const initiative = tree.nodes.find((n) => n.ref_id === root);
  if (!initiative) return false;
  const name = String(initiative.properties.name ?? "this initiative");
  const of = (t: InitiativeTreeType) => tree.nodes.filter((n) => n.type === t);
  const plan = planFor(name);
  const steps: Array<() => void> = [];
  if (!of("Brief").length)
    steps.push(() =>
      strutWrite(
        "Brief",
        { text: `Why ${name}: drafted by strut from the conversation so far.` },
        { id: root, edge: "HAS_BRIEF" },
      ),
    );
  const existing = of("HiveMilestone").sort(
    (a, b) => Number(a.properties.sequence ?? 0) - Number(b.properties.sequence ?? 0),
  );
  const milestones: Array<string | undefined> = plan.map((_, i) => existing[i]?.ref_id);
  if (!existing.length)
    plan.forEach((m, i) =>
      steps.push(() => {
        milestones[i] = strutWrite(
          "HiveMilestone",
          { name: m.milestone, sequence: i + 1 },
          { id: root, edge: "HAS_MILESTONE" },
        );
      }),
    );
  if (!of("UserStory").length)
    plan.forEach((m, i) => {
      let story = "";
      steps.push(() => {
        story = strutWrite("UserStory", { text: m.story, status: "proposed" }, { id: root, edge: "HAS_STORY" });
      });
      for (const r of m.reqs)
        steps.push(() => {
          const req = strutWrite(
            "Requirement",
            { text: r, status: "proposed" },
            { id: story, edge: "HAS_REQUIREMENT" },
          );
          if (milestones[i]) s.scheduled.set(req, milestones[i]!);
        });
    });
  plan.forEach((m, i) => {
    if (existing[i] && tree.edges.some((e) => e.source === existing[i].ref_id && e.type === "HAS_FEATURE")) return;
    for (const f of m.features)
      steps.push(() => {
        if (milestones[i])
          strutWrite("InitiativeFeature", { name: f, status: "proposed" }, { id: milestones[i]!, edge: "HAS_FEATURE" });
      });
  });
  if (!steps.length) return false;
  s.building.add(root);
  steps.forEach((step, i) =>
    setTimeout(
      () => {
        step();
        progress?.step();
        if (i === steps.length - 1) {
          s.building.delete(root);
          progress?.done(steps.length);
        }
      },
      (i + 1) * STEP_MS,
    ),
  );
  return true;
}

/** What a brainstorm's answers make, by what it's about: milestones for an initiative, features for a milestone. */
const BRAINSTORM_ANSWERS: Record<string, Array<{ text: string; makes: string[] }>> = {
  HiveInitiative: [
    { text: "Ship the smallest slice first, then widen", makes: ["Pilot with one team", "Open to every team"] },
    { text: "One milestone per journey", makes: ["First journey end to end", "Second journey end to end"] },
    { text: "Build the platform first", makes: ["Platform", "Journeys on the platform"] },
  ],
  HiveMilestone: [
    { text: "Smallest thing that works, behind a switch", makes: ["Minimal version behind a switch"] },
    { text: "Reuse what the canvas already has", makes: ["Reuse the existing pieces"] },
    { text: "Build it properly once, tests first", makes: ["Full build", "Test harness"] },
  ],
  InitiativeFeature: [
    { text: "Smallest thing that works, behind a switch", makes: [] },
    { text: "Reuse what the canvas already has", makes: [] },
    { text: "Build it properly once, tests first", makes: [] },
  ],
};

/**
 * Fakes strut's `brainstorm` on one card (an initiative, milestone or
 * feature): a root question about it with three answers, each listing what
 * choosing it makes, written to the brainstorm store and linked to the card
 * (the graph's Question -ABOUT-> node). Returns the question's ref_id.
 */
export function startMockBrainstorm(nodeRef: string, nodeName: string, nodeType: string): string {
  const stamp = Date.now();
  const answers = BRAINSTORM_ANSWERS[nodeType] ?? BRAINSTORM_ANSWERS.InitiativeFeature;
  const plan: SavePlan = {
    creates: [
      {
        temp: "q",
        nodeType: "Question",
        parent: null,
        data: {
          question_id: `${stamp}-q`,
          text: nodeType === "HiveInitiative" ? `How should we stage ${nodeName}?` : `How should we build ${nodeName}?`,
          made_by: "model",
          state: "open",
          job: "job-mock-brainstorm",
        },
      },
      ...answers.map((a, i) => ({
        temp: `o${i}`,
        nodeType: "Option" as const,
        parent: { temp: "q" },
        data: {
          option_id: `${stamp}-o${i}`,
          kind: "option",
          text: a.text,
          makes: a.makes,
          made_by: "model",
          state: "open",
        },
      })),
    ],
    patches: {},
    links: [],
  };
  const root = mockBrainstormWrite(plan).q;
  const s = store();
  s.brainstorms.set(nodeRef, [...(s.brainstorms.get(nodeRef) ?? []), root]);
  return root;
}
