import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { WorkflowStatus } from "@/lib/chat";

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

const STAKWORK_URL = "https://jobs.stakwork.com/admin/projects/99999";

describe("WorkflowStatusBadge", () => {
  describe("IN_PROGRESS state", () => {
    test("renders an <a> tag linking to Stakwork when stakworkProjectId is present", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} stakworkProjectId="99999" />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
      expect(link).toHaveAttribute("target", "_blank");
    });

    test("renders a <div> (not a link) when stakworkProjectId is absent", () => {
      render(<WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} />);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("renders a <div> (not a link) when stakworkProjectId is null", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} stakworkProjectId={null} />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("displays 'Working...' label", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} stakworkProjectId="99999" />
      );
      expect(screen.getByText("Working...")).toBeInTheDocument();
    });
  });

  describe("Terminal states (regression)", () => {
    test("ERROR + stakworkProjectId → renders an <a> tag", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.ERROR} stakworkProjectId="99999" />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("HALTED + stakworkProjectId → renders an <a> tag", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.HALTED} stakworkProjectId="99999" />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("FAILED + stakworkProjectId → renders an <a> tag", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.FAILED} stakworkProjectId="99999" />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("ERROR without stakworkProjectId → renders a <div>", () => {
      render(<WorkflowStatusBadge status={WorkflowStatus.ERROR} />);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });
  });

  describe("Non-clickable states", () => {
    test("PENDING renders a <div> regardless of stakworkProjectId", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.PENDING} stakworkProjectId="99999" />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("COMPLETED renders a <div> regardless of stakworkProjectId", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.COMPLETED} stakworkProjectId="99999" />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });
  });
});
