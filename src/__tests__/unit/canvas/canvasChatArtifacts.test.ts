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
  indexArtifactVersions,
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

  test("an html page is named by its slug", () => {
    expect(parseArtifactContent("html", { slug: "roadmap", updatedAt: "2026-09-30" })).toEqual({
      slug: "roadmap",
      updatedAt: "2026-09-30",
    });
    expect(parseArtifactContent("html", { slug: "" })).toBeNull();
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

  test("a pull request keeps an artifact id string when present", () => {
    expect(parseArtifactContent("pull_request", { ...pullRequest, artifactId: "art-1" })).toEqual({
      ...pullRequest,
      artifactId: "art-1",
    });
    expect(parseArtifactContent("pull_request", { ...pullRequest, artifactId: "" })).toEqual(pullRequest);
    expect(parseArtifactContent("pull_request", { ...pullRequest, artifactId: 7 })).toEqual(pullRequest);
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

describe("versions", () => {
  const ref = (id: string, key: string): ArtifactRef => ({
    id,
    kind: "markdown",
    title: id,
    source: { type: "graph", swarmId: "swarm-1", key },
  });
  const planV1 = ref("plan", "k1");
  const shot = ref("shot", "k2");
  const planV2 = ref("plan", "k3");
  const all = listArtifacts([{ artifacts: [planV1] }, {}, { artifacts: [shot, planV2] }]);

  test("listArtifacts gathers the refs the messages hold, oldest first, as the same objects", () => {
    expect(all).toHaveLength(3);
    expect(all[0]).toBe(planV1);
    expect(all[1]).toBe(shot);
    expect(all[2]).toBe(planV2);
  });

  test("listArtifacts is empty when there are none", () => {
    expect(listArtifacts([{}])).toEqual([]);
    expect(listArtifacts(undefined)).toEqual([]);
  });

  test("the same id later is the next version", () => {
    const versions = indexArtifactVersions(all);
    expect(versions.get(planV1)).toEqual({ index: 0, count: 2 });
    expect(versions.get(planV2)).toEqual({ index: 1, count: 2 });
    expect(versions.get(shot)).toEqual({ index: 0, count: 1 });
  });

  test("latestArtifacts keeps the newest of each, where each first appeared", () => {
    expect(latestArtifacts(all)).toEqual([planV2, shot]);
  });

  test("the panel follows the newest version until one is picked", () => {
    expect(resolveArtifactPanel(all, { artifactId: "plan", version: null })?.artifact).toBe(planV2);
    expect(resolveArtifactPanel(all, { artifactId: "plan", version: 0 })?.artifact).toBe(planV1);
    expect(resolveArtifactPanel(all, { artifactId: "plan", version: 0 })?.versions).toEqual([planV1, planV2]);
  });

  test("a version past the end shows the newest", () => {
    expect(resolveArtifactPanel(all, { artifactId: "plan", version: 9 })?.index).toBe(1);
  });

  test("nothing is on the panel when it is closed or the artifact is not in the conversation", () => {
    expect(resolveArtifactPanel(all, null)).toBeNull();
    expect(resolveArtifactPanel(all, { artifactId: "gone", version: null })).toBeNull();
  });
});
