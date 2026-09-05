// @vitest-environment jsdom
/**
 * Unit tests for the control-panel `StateDot` tone mapping.
 *
 * Four tones: green filled for done (a plan, or a Jamie parent whose
 * nested features are all COMPLETED), amber pulse while running, amber
 * ring while waiting on you, grey when idle.
 */
import React from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateDot } from "@/app/org/[githubLogin]/_components/control-panel/ControlPanelList";

describe("StateDot", () => {
  test("done is a green filled dot labelled Done", () => {
    render(<StateDot state="done" />);
    const dot = screen.getByRole("img", { name: "Done" });
    expect(dot).toHaveClass("bg-green-500");
    expect(dot).not.toHaveClass("animate-pulse");
    expect(dot).toHaveAttribute("title", "Done");
  });

  test("running is an amber pulse labelled Agent working", () => {
    render(<StateDot state="running" />);
    const dot = screen.getByRole("img", { name: "Agent working" });
    expect(dot).toHaveClass("animate-pulse", "bg-amber-500");
    expect(dot).toHaveAttribute("title", "Agent working");
  });

  test("awaiting-reply is an amber ring labelled Waiting on you", () => {
    render(<StateDot state="awaiting-reply" />);
    const dot = screen.getByRole("img", { name: "Waiting on you" });
    expect(dot).toHaveClass("border-2", "border-amber-500", "bg-transparent");
    expect(dot).toHaveAttribute("title", "Waiting on you");
  });

  test("none is a grey idle dot labelled Nothing happening", () => {
    render(<StateDot state="none" />);
    const dot = screen.getByRole("img", { name: "Nothing happening" });
    expect(dot).toHaveClass("bg-muted-foreground/40");
    expect(dot).toHaveAttribute("title", "Nothing happening");
  });
});
