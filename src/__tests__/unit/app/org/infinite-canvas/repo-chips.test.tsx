// @vitest-environment jsdom
import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoChips } from "@/app/org/[githubLogin]/_components/infinite-canvas/nodes";

vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/fonts", () => ({
  serif: { style: { fontFamily: "serif" } },
  hand: { className: "", style: { fontFamily: "cursive" } },
}));

describe("RepoChips", () => {
  it("renders nothing without repos", () => {
    render(<RepoChips id="f" repos={[]} />);
    expect(screen.queryByTestId("feature-repos:f")).toBeNull();
  });

  it("shows short names with the full name in the title", () => {
    render(<RepoChips id="f" repos={["acme/web", "acme/api"]} />);
    expect(screen.getByTestId("feature-repos:f").textContent).toBe("webapi");
    expect(screen.getByTitle("acme/web").textContent).toBe("web");
  });

  it("shows the first three, then +N", () => {
    render(<RepoChips id="f" repos={["a/1", "a/2", "a/3", "a/4", "a/5"]} />);
    expect(screen.getByTestId("feature-repos:f").textContent).toBe("123+2");
  });
});
