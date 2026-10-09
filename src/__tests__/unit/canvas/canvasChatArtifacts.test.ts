/**
 * The canvas chat's artifact refs and their content
 * (`_state/canvasChatArtifacts.ts`).
 *
 * Refs come out of stored conversation JSON and content out of other
 * systems, so the parsers are the boundary: what is whole passes as it
 * is, what is not is dropped, and nothing is repaired on the way in.
 */
import { describe, test, expect } from "vitest";
import {
  artifactIdentity,
  indexArtifactCards,
  latestArtifacts,
  listArtifacts,
  parseArtifactContent,
  parseArtifactRefs,
  resolveArtifactPanel,
  type ArtifactRef,
} from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const graph = { type: "graph", swarmId: "swarm-1", key: "node-1" };
const whole = { id: "plan", kind: "markdown", title: "Plan", label: "Plan", summary: "Three phases.", source: graph };

describe("parseArtifactRefs", () => {
  test("keeps a whole ref as it is", () => {
    expect(parseArtifactRefs([whole])).toEqual([whole]);
  });

  test("is undefined when there is nothing to keep", () => {
    expect(parseArtifactRefs(undefined)).toBeUndefined();
    expect(parseArtifactRefs("not a list")).toBeUndefined();
    expect(parseArtifactRefs([])).toBeUndefined();
    expect(parseArtifactRefs([{ id: "only-an-id" }])).toBeUndefined();
  });

  test("drops a ref of a kind it does not know and keeps its neighbours in order", () => {
    const refs = parseArtifactRefs([whole, { ...whole, id: "b", kind: "spreadsheet" }, { ...whole, id: "c" }]);
    expect(refs?.map((ref) => ref.id)).toEqual(["plan", "c"]);
  });

  test("drops a ref without an id or a title, or with an id past the bound", () => {
    expect(
      parseArtifactRefs([
        { ...whole, id: "" },
        { ...whole, title: 5 },
        { ...whole, id: "x".repeat(201) },
      ]),
    ).toBeUndefined();
  });

  test("keeps a ref whose label or summary does not fit, without them", () => {
    const [ref] = parseArtifactRefs([{ ...whole, label: "y".repeat(61), summary: 7 }]) ?? [];
    expect(ref).toEqual({ id: "plan", kind: "markdown", title: "Plan", source: graph });
  });

  test("reads an inline source", () => {
    const source = { type: "inline", content: { url: "https://example.test" } };
    expect(parseArtifactRefs([{ ...whole, source }])?.[0].source).toEqual(source);
  });

  test("drops a ref whose source it cannot read", () => {
    expect(
      parseArtifactRefs([
        { ...whole, source: { type: "s3", key: "k" } },
        { ...whole, source: { type: "graph", swarmId: "swarm-1" } },
        { ...whole, source: { type: "inline", content: "text" } },
        { ...whole, source: null },
      ]),
    ).toBeUndefined();
  });

  test("keeps only the fields a ref has", () => {
    const stored = { ...whole, text: "a body that does not belong on a ref", source: { ...graph, extra: 1 } };
    expect(parseArtifactRefs([stored])).toEqual([whole]);
  });

  test("keeps no more than twenty refs from one message", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...whole, id: `artifact-${i}` }));
    expect(parseArtifactRefs(many)).toHaveLength(20);
  });
});

describe("parseArtifactContent", () => {
  const file = { file: "a.ts", action: "modify", content: "@@ -1 +1 @@", repoName: "owner/repo" };
  const pullRequest = { url: "https://github.com/owner/repo/pull/1", repo: "owner/repo", number: 1, state: "open" };

  test("is null for anything that is not an object", () => {
    expect(parseArtifactContent("markdown", "text")).toBeNull();
    expect(parseArtifactContent("markdown", null)).toBeNull();
    expect(parseArtifactContent("json", [1, 2])).toBeNull();
  });

  test("text kinds need their text, which may be empty", () => {
    expect(parseArtifactContent("markdown", { text: "# Plan" })).toEqual({ text: "# Plan" });
    expect(parseArtifactContent("log", { text: "" })).toEqual({ text: "" });
    expect(parseArtifactContent("markdown", { text: 1 })).toBeNull();
  });

  test("kinds that are an address need one", () => {
    expect(parseArtifactContent("url", { url: "https://example.test" })).toEqual({ url: "https://example.test" });
    expect(parseArtifactContent("audio", { url: "note.wav" })).toEqual({ url: "note.wav" });
    expect(parseArtifactContent("pdf", { url: "brief.pdf" })).toEqual({ url: "brief.pdf" });
    expect(parseArtifactContent("url", { url: "" })).toBeNull();
    expect(parseArtifactContent("pdf", { href: "brief.pdf" })).toBeNull();
  });

  test("optional parts are kept when they fit and left out when they do not", () => {
    expect(parseArtifactContent("image", { url: "shot.png", alt: "A screenshot", width: 3 })).toEqual({
      url: "shot.png",
      alt: "A screenshot",
    });
    expect(parseArtifactContent("image", { url: "shot.png", alt: 4 })).toEqual({ url: "shot.png" });
    expect(parseArtifactContent("video", { url: "clip.mp4", poster: "clip.png" })).toEqual({
      url: "clip.mp4",
      poster: "clip.png",
    });
    expect(parseArtifactContent("code", { code: "x", filename: "a.ts", language: 3 })).toEqual({
      code: "x",
      filename: "a.ts",
    });
  });

  test("an html page is a stored page by its slug, or a page on a swarm by where it is", () => {
    expect(parseArtifactContent("html", { slug: "roadmap", updatedAt: "2026-09-30" })).toEqual({
      slug: "roadmap",
      updatedAt: "2026-09-30",
    });
    expect(parseArtifactContent("html", { slug: "" })).toBeNull();
    expect(parseArtifactContent("html", { swarmId: "swarm-1", key: "/jobs/j/files/plan.html" })).toEqual({
      swarmId: "swarm-1",
      key: "/jobs/j/files/plan.html",
    });
    expect(parseArtifactContent("html", { swarmId: "swarm-1" })).toBeNull();
    expect(parseArtifactContent("html", { key: "/jobs/j/files/plan.html" })).toBeNull();
  });

  test("a diff is every file or nothing", () => {
    expect(parseArtifactContent("diff", { diffs: [file] })).toEqual({ diffs: [file] });
    expect(parseArtifactContent("diff", { diffs: [] })).toEqual({ diffs: [] });
    expect(parseArtifactContent("diff", { diffs: [file, { ...file, action: "rename" }] })).toBeNull();
    expect(parseArtifactContent("diff", {})).toBeNull();
  });

  test("a pull request needs where it is, its repo, its number and its state", () => {
    expect(parseArtifactContent("pull_request", pullRequest)).toEqual(pullRequest);
    expect(parseArtifactContent("pull_request", { ...pullRequest, state: "approved" })).toBeNull();
    expect(parseArtifactContent("pull_request", { ...pullRequest, number: "1" })).toBeNull();
    expect(parseArtifactContent("pull_request", { ...pullRequest, number: 1.5 })).toBeNull();
  });

  test("a pull request keeps a check's page and its head commit", () => {
    const full = {
      ...pullRequest,
      headSha: "a1b2c3d",
      checks: [{ name: "lint", status: "failure", url: "https://github.com/acme/app/actions/runs/1" }, { name: "build", status: "success" }],
    };
    expect(parseArtifactContent("pull_request", full)).toEqual(full);
    // An empty or non-string url is no url.
    expect(parseArtifactContent("pull_request", { ...pullRequest, checks: [{ name: "lint", status: "failure", url: "" }] })).toEqual({
      ...pullRequest,
      checks: [{ name: "lint", status: "failure" }],
    });
  });

  test("a pull request keeps its checks and files whole", () => {
    const full = {
      ...pullRequest,
      author: "jamie",
      headBranch: "feature",
      baseBranch: "master",
      body: "What changed",
      checks: [{ name: "build", status: "success" }],
      diffs: [file],
    };
    expect(parseArtifactContent("pull_request", full)).toEqual(full);
    expect(
      parseArtifactContent("pull_request", { ...pullRequest, checks: [{ name: "build", status: "green" }] }),
    ).toBeNull();
    expect(parseArtifactContent("pull_request", { ...pullRequest, diffs: "a patch" })).toBeNull();
  });

  test("code needs its code", () => {
    expect(parseArtifactContent("code", { filename: "a.ts" })).toBeNull();
  });

  test("json needs a value, which may be null", () => {
    expect(parseArtifactContent("json", { value: null })).toEqual({ value: null });
    expect(parseArtifactContent("json", { value: { a: 1 } })).toEqual({ value: { a: 1 } });
    expect(parseArtifactContent("json", {})).toBeNull();
  });
});

describe("identity and versions", () => {
  const file = (id: string, key: string): ArtifactRef => ({
    id,
    kind: "markdown",
    title: id,
    source: { type: "graph", swarmId: "swarm-1", key },
  });
  const note = (id: string, text: string): ArtifactRef => ({
    id,
    kind: "markdown",
    title: id,
    source: { type: "inline", content: { text } },
  });
  const pr = (id: string, repo: string, number: number): ArtifactRef => ({
    id,
    kind: "pull_request",
    title: id,
    source: {
      type: "inline",
      content: { url: `https://github.com/${repo}/pull/${number}`, repo, number, state: "open" },
    },
  });
  // Turn 1: the plan and a screenshot. Turn 2: a note and the PR. Turn 4:
  // the plan again under another name, a new screenshot under the same
  // name, the note again, and the PR again under another name and case.
  const planT1 = file("plan", "/jobs/j/files/plan.md");
  const shotT1 = file("shot", "/artifacts/run-1/shot.png");
  const noteT2 = note("note", "first");
  const prT2 = pr("pr", "Acme/App", 7);
  const planT4 = file("plan-v2", "/jobs/j/files/plan.md");
  const shotT4 = file("shot", "/artifacts/run-4/shot.png");
  const noteT4 = note("note", "second");
  const prT4 = pr("pull-request-7", "acme/app", 7);
  const all = listArtifacts([
    { artifacts: [planT1, shotT1] },
    { artifacts: [noteT2, prT2] },
    {},
    { artifacts: [planT4, shotT4, noteT4, prT4] },
  ]);

  test("listArtifacts gathers the refs the messages hold, oldest first, as the same objects", () => {
    expect(all).toHaveLength(8);
    expect(all[0]).toBe(planT1);
    expect(all[2]).toBe(noteT2);
    expect(all[7]).toBe(prT4);
  });

  test("listArtifacts is empty when there are none", () => {
    expect(listArtifacts([{}])).toEqual([]);
    expect(listArtifacts(undefined)).toEqual([]);
  });

  test("what a ref is read from is its identity; a snapshot goes by its id", () => {
    // The same file under another name is the same artifact; the same name on another run is not.
    expect(artifactIdentity(planT4)).toBe(artifactIdentity(planT1));
    expect(artifactIdentity(shotT4)).not.toBe(artifactIdentity(shotT1));
    // A pull request is its repo and number, whatever it was called, in any case.
    expect(artifactIdentity(prT4)).toBe(artifactIdentity(prT2));
    // Inline content is a snapshot: the same id is a version, another id is another artifact.
    expect(artifactIdentity(noteT4)).toBe(artifactIdentity(noteT2));
    expect(artifactIdentity(note("other", "first"))).not.toBe(artifactIdentity(noteT2));
    // An inline id never collides with a live key.
    expect(artifactIdentity(note("graph:swarm-1:/jobs/j/files/plan.md", "x"))).not.toBe(artifactIdentity(planT1));
  });

  test("a stored page is its slug, an address is its URL, and a pull request without one is its id", () => {
    const page = (id: string, slug: string): ArtifactRef => ({
      id,
      kind: "html",
      title: id,
      source: { type: "inline", content: { slug } },
    });
    const pod = (id: string, url: string): ArtifactRef => ({
      id,
      kind: "url",
      title: id,
      source: { type: "inline", content: { url } },
    });
    expect(artifactIdentity(page("a", "s"))).toBe(artifactIdentity(page("b", "s")));
    expect(artifactIdentity(pod("a", "https://pod"))).toBe(artifactIdentity(pod("b", "https://pod")));
    expect(artifactIdentity(pod("a", "https://pod"))).not.toBe(artifactIdentity(pod("a", "https://other")));
    const bare: ArtifactRef = {
      id: "x",
      kind: "pull_request",
      title: "x",
      source: { type: "inline", content: { url: "u" } },
    };
    expect(artifactIdentity(bare)).toBe("id:x");
  });

  test("each artifact gets one card, on its newest ref, with its versions counted", () => {
    const cards = indexArtifactCards(all);
    expect([...cards.keys()]).toEqual([planT4, shotT1, noteT4, prT4, shotT4]);
    // Read live: one version, however many turns reported it.
    expect(cards.get(planT4)).toEqual({ index: 0, count: 1 });
    expect(cards.get(prT4)).toEqual({ index: 0, count: 1 });
    // Snapshots: the newest of two.
    expect(cards.get(noteT4)).toEqual({ index: 1, count: 2 });
    // Two screenshots are two artifacts.
    expect(cards.get(shotT1)).toEqual({ index: 0, count: 1 });
    expect(cards.get(shotT4)).toEqual({ index: 0, count: 1 });
    // Earlier reports get no card.
    expect(cards.has(planT1)).toBe(false);
    expect(cards.has(noteT2)).toBe(false);
    expect(cards.has(prT2)).toBe(false);
  });

  test("latestArtifacts keeps the newest ref of each, where each first appeared", () => {
    expect(latestArtifacts(all)).toEqual([planT4, shotT1, noteT4, prT4, shotT4]);
  });

  test("the panel steps between a snapshot's versions, following the newest until one is picked", () => {
    const identity = artifactIdentity(noteT2);
    expect(resolveArtifactPanel(all, { identity, version: null })?.artifact).toBe(noteT4);
    expect(resolveArtifactPanel(all, { identity, version: 0 })?.artifact).toBe(noteT2);
    expect(resolveArtifactPanel(all, { identity, version: 0 })?.versions).toEqual([noteT2, noteT4]);
  });

  test("what is read live has one version, its newest ref, whichever ref opened it", () => {
    const plan = resolveArtifactPanel(all, { identity: artifactIdentity(planT1), version: 0 });
    expect(plan?.artifact).toBe(planT4);
    expect(plan?.versions).toEqual([planT4]);
    expect(plan?.index).toBe(0);
    expect(resolveArtifactPanel(all, { identity: artifactIdentity(prT2), version: null })?.versions).toEqual([prT4]);
  });

  test("a version past the end shows the newest", () => {
    expect(resolveArtifactPanel(all, { identity: artifactIdentity(noteT2), version: 9 })?.index).toBe(1);
  });

  test("nothing is on the panel when it is closed or the artifact is not in the conversation", () => {
    expect(resolveArtifactPanel(all, null)).toBeNull();
    expect(resolveArtifactPanel(all, { identity: "id:gone", version: null })).toBeNull();
  });
});
