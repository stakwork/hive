// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";

const baseProps = {
  url: "https://github.com/org/repo/pull/1",
};

describe("PRStatusBadge", () => {
  test("renders open badge with no CI icon when ciStatus is absent", () => {
    render(<PRStatusBadge {...baseProps} status="IN_PROGRESS" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByTitle(/passed|failed|pending/i)).not.toBeInTheDocument();
    // no spinner, no check, no x
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  test("shows Loader2 spinner for ciStatus=pending on open PR", () => {
    render(
      <PRStatusBadge {...baseProps} status="IN_PROGRESS" ciStatus="pending" ciSummary="Checks running" />
    );
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
    expect(spinner?.closest('[title="Checks running"]')).not.toBeNull();
  });

  test("shows CheckCircle2 for ciStatus=success on open PR", () => {
    render(
      <PRStatusBadge {...baseProps} status="IN_PROGRESS" ciStatus="success" ciSummary="5/5 passed" />
    );
    // The success icon should have title
    const icon = document.querySelector('[title="5/5 passed"]');
    expect(icon).not.toBeNull();
    // No spinner
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  test("shows XCircle for ciStatus=failure on open PR", () => {
    render(
      <PRStatusBadge {...baseProps} status="IN_PROGRESS" ciStatus="failure" ciSummary="build: failed" />
    );
    const icon = document.querySelector('[title="build: failed"]');
    expect(icon).not.toBeNull();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  test("does not show CI icon when status=DONE even if ciStatus provided", () => {
    render(
      <PRStatusBadge {...baseProps} status="DONE" ciStatus="success" ciSummary="5/5 passed" />
    );
    expect(screen.getByText("Merged")).toBeInTheDocument();
    expect(document.querySelector('[title="5/5 passed"]')).toBeNull();
  });

  test("does not show CI icon when status=CANCELLED even if ciStatus provided", () => {
    render(
      <PRStatusBadge {...baseProps} status="CANCELLED" ciStatus="failure" ciSummary="build: failed" />
    );
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(document.querySelector('[title="build: failed"]')).toBeNull();
  });

  test("title attribute on CI icon equals ciSummary", () => {
    render(
      <PRStatusBadge {...baseProps} status="IN_PROGRESS" ciStatus="success" ciSummary="all green" />
    );
    expect(document.querySelector('[title="all green"]')).not.toBeNull();
  });
});
