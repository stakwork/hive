import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const frame = vi.fn((_: Record<string, unknown>) => null);
vi.mock("@/components/html-artifact/HtmlArtifactFrame", () => ({ HtmlArtifactFrame: (p: Record<string, unknown>) => frame(p) }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "acme" }));
const stamp = vi.fn((_l: string, _s: string | null, initial?: string) => initial);
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useHtmlPageStamp", () => ({
  useHtmlPageStamp: (l: string, s: string | null, i?: string) => stamp(l, s, i),
}));

import { HtmlPanel, updatedAtOf } from "@/app/org/[githubLogin]/_components/artifacts/viewers/html";

globalThis.React = React;
const artifact = { id: "a", kind: "html", title: "T", source: { type: "inline", content: {} } } as never;

describe("HtmlPanel", () => {
  test("updatedAtOf: stored and swarm pages both carry their version", () => {
    expect(updatedAtOf({ slug: "p", updatedAt: "x" })).toBe("x");
    expect(updatedAtOf({ swarmId: "s", key: "/jobs/a/files/b.html", updatedAt: "y" })).toBe("y");
    expect(updatedAtOf({ swarmId: "s", key: "/jobs/a/files/b.html" })).toBeUndefined();
  });

  test("a slug page follows the live stamp", () => {
    stamp.mockReturnValueOnce("live");
    render(<HtmlPanel artifact={artifact} content={{ slug: "p", updatedAt: "x" }} />);
    expect(stamp).toHaveBeenCalledWith("acme", "p", "x");
    expect(frame).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: "live", source: { githubLogin: "acme", slug: "p" } }));
  });

  test("a swarm page subscribes to nothing and passes its version", () => {
    render(<HtmlPanel artifact={artifact} content={{ swarmId: "s", key: "/jobs/a/files/b.html", updatedAt: "y" }} />);
    expect(stamp).toHaveBeenLastCalledWith("acme", null, "y");
  });
});
