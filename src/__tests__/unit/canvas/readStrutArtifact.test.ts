/**
 * The app's artifact loader for `graph` refs
 * (`_components/artifacts/useArtifactContent.ts` `readStrutArtifact`): a
 * strut job's file read through Hive's reader route, shaped per kind.
 */
import { describe, test, expect, vi } from "vitest";
import { ArtifactLoadError, readStrutArtifact } from "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const KEY = "/jobs/6f1c/files/plan.md";
const READER = "/api/orgs/acme/strut/artifacts?swarmId=swarm-1&key=%2Fjobs%2F6f1c%2Ffiles%2Fplan.md";
const ref = (kind: ArtifactRef["kind"], key = KEY): ArtifactRef => ({
  id: "a",
  kind,
  title: "A",
  source: { type: "graph", swarmId: "swarm-1", key },
});
const ctx = { githubLogin: "acme" };
const text = (body: string, status = 200) => vi.fn(async () => new Response(body, { status }));

describe("readStrutArtifact", () => {
  test("media, a pdf and a page are an address on Hive's own origin — no fetch", async () => {
    const fetchImpl = vi.fn();
    for (const kind of ["image", "video", "audio", "pdf", "url"] as const) {
      expect(await readStrutArtifact(ref(kind), ctx, fetchImpl)).toEqual({ url: READER });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("text kinds are fetched through the reader and shaped for their viewer", async () => {
    const fetchImpl = text("# Plan");
    expect(await readStrutArtifact(ref("markdown"), ctx, fetchImpl)).toEqual({ text: "# Plan" });
    expect(fetchImpl).toHaveBeenCalledWith(READER, { credentials: "same-origin" });
    expect(await readStrutArtifact(ref("log"), ctx, text("line"))).toEqual({ text: "line" });
    expect(await readStrutArtifact(ref("code", "/jobs/6f1c/files/src/app.ts"), ctx, text("const a = 1;"))).toEqual({
      code: "const a = 1;",
      filename: "app.ts",
    });
    expect(await readStrutArtifact(ref("json"), ctx, text('{"a":1}'))).toEqual({ value: { a: 1 } });
  });

  test("what bytes on a swarm cannot be, and what the reader refuses", async () => {
    await expect(readStrutArtifact(ref("html"), ctx, text("<h1/>"))).rejects.toMatchObject({ reason: "unavailable" });
    await expect(readStrutArtifact(ref("diff"), ctx, text(""))).rejects.toMatchObject({ reason: "unavailable" });
    await expect(readStrutArtifact(ref("json"), ctx, text("not json"))).rejects.toMatchObject({ reason: "unavailable" });
    await expect(readStrutArtifact(ref("markdown"), ctx, text("", 404))).rejects.toMatchObject({ reason: "unavailable" });
    await expect(readStrutArtifact(ref("markdown"), ctx, text("", 403))).rejects.toMatchObject({ reason: "denied" });
    await expect(readStrutArtifact(ref("markdown"), ctx, text("", 401))).rejects.toMatchObject({ reason: "denied" });
    await expect(readStrutArtifact(ref("markdown"), ctx, text("", 502))).rejects.toMatchObject({ reason: "failed" });
    await expect(readStrutArtifact(ref("markdown"), ctx, vi.fn().mockRejectedValue(new Error("offline")))).rejects.toBeInstanceOf(ArtifactLoadError);
    const inline: ArtifactRef = { ...ref("markdown"), source: { type: "inline", content: { text: "x" } } };
    await expect(readStrutArtifact(inline, ctx, text(""))).rejects.toMatchObject({ reason: "unavailable" });
  });
});
